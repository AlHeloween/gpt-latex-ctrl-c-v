(() => {
  const cof = (globalThis.__cof = globalThis.__cof || {});
  const diag = cof.diag || (() => {});

  // Use plain-text sentinels instead of HTML comments.
  // Rationale: many translators treat HTML comments as removable/markup and may drop/mangle them.
  // Sentinels are designed to be preserved by both MT and LLM providers.
  const FORMULA_ANCHOR_PREFIX = "[[COF_FORMULA_";
  const CODE_ANCHOR_PREFIX = "[[COF_CODE_";
  const ANCHOR_SUFFIX = "]]";

  function createAnchor(type, index) {
    return `[[COF_${type}_${index}]]`;
  }

  function parseAnchor(anchor) {
    const s = String(anchor || "");

    // New format: [[COF_FORMULA_12]] / [[COF_CODE_7]]
    let m = s.match(/^\[\[COF_(FORMULA|CODE)_(\d+)\]\]$/);
    if (m) return { type: m[1], index: parseInt(m[2], 10) };

    // Legacy format (kept for backward compatibility/tests):
    // <!--FORMULA_ANCHOR_12--> / <!--CODE_ANCHOR_7-->
    m = s.match(/^<!--(FORMULA|CODE)_ANCHOR_(\d+)-->$/);
    if (m) return { type: m[1], index: parseInt(m[2], 10) };

    return null;
  }

  function anchorFormulasAndCode(html) {
    const anchors = {
      formulas: [],
      codes: [],
      // Marker -> index in formulas/codes arrays (order-independent restore)
      formulaPosByMarker: {},
      codePosByMarker: {},
    };
    let anchorIndex = 0;
    let result = html;

    // Pattern 1: MathML elements (<math>...</math>)
    const mathPattern = /<math[\s\S]*?<\/math>/gi;
    result = result.replace(mathPattern, (match) => {
      const anchor = createAnchor("FORMULA", anchorIndex);
      anchors.formulaPosByMarker[anchor] = anchors.formulas.length;
      anchors.formulas.push(match);
      anchorIndex++;
      return anchor;
    });

    // Pattern 2: LaTeX placeholders (<!--COF_TEX_0-->, <!--COF_TEX_1-->, etc.)
    const latexPattern = /<!--COF_TEX_\d+-->/g;
    result = result.replace(latexPattern, (match) => {
      const anchor = createAnchor("FORMULA", anchorIndex);
      anchors.formulaPosByMarker[anchor] = anchors.formulas.length;
      anchors.formulas.push(match);
      anchorIndex++;
      return anchor;
    });

    // Pattern 3: data-math attributes (span with data-math="...")
    const dataMathPattern = /<[^>]*\sdata-math=["'][^"']*["'][^>]*>[\s\S]*?<\/[^>]+>/gi;
    result = result.replace(dataMathPattern, (match) => {
      const anchor = createAnchor("FORMULA", anchorIndex);
      anchors.formulaPosByMarker[anchor] = anchors.formulas.length;
      anchors.formulas.push(match);
      anchorIndex++;
      return anchor;
    });

    // Pattern 4: OMML conditional comments (<!--[if gte msEquation 12]>...<![endif]-->)
    const ommlPattern = /<!--\[if[^>]*>[\s\S]*?<!\[endif\]-->/gi;
    result = result.replace(ommlPattern, (match) => {
      if (match.includes("m:oMath") || match.includes("Equation")) {
        const anchor = createAnchor("FORMULA", anchorIndex);
        anchors.formulaPosByMarker[anchor] = anchors.formulas.length;
        anchors.formulas.push(match);
        anchorIndex++;
        return anchor;
      }
      return match;
    });

    // Pattern 5: Code blocks (<pre>...</pre>)
    const prePattern = /<pre[\s\S]*?<\/pre>/gi;
    result = result.replace(prePattern, (match) => {
      const anchor = createAnchor("CODE", anchorIndex);
      anchors.codePosByMarker[anchor] = anchors.codes.length;
      anchors.codes.push(match);
      anchorIndex++;
      return anchor;
    });

    // Pattern 6: Inline code (<code>...</code>) - but only if not inside <pre>
    // Simple approach: replace code tags that are not inside pre blocks
    // We'll use a simpler regex approach since we already handled <pre> blocks
    const codePattern = /<code[^>]*>[\s\S]*?<\/code>/gi;
    let codeMatches = [];
    let match;
    while ((match = codePattern.exec(result)) !== null) {
      // Check if this match is inside a pre block by looking at the position
      const beforeMatch = result.substring(0, match.index);
      const lastPreStart = beforeMatch.lastIndexOf("<pre");
      const lastPreEnd = beforeMatch.lastIndexOf("</pre>");
      const isInsidePre = lastPreStart > lastPreEnd && lastPreStart >= 0;
      
      if (!isInsidePre) {
        codeMatches.push({
          match: match[0],
          index: match.index,
        });
      }
    }
    
    // Replace code blocks in reverse order to preserve indices
    for (let i = codeMatches.length - 1; i >= 0; i--) {
      const codeMatch = codeMatches[i];
      const anchor = createAnchor("CODE", anchorIndex);
      anchors.codePosByMarker[anchor] = anchors.codes.length;
      anchors.codes.push(codeMatch.match);
      result = result.substring(0, codeMatch.index) + anchor + result.substring(codeMatch.index + codeMatch.match.length);
      anchorIndex++;
    }

    return { html: result, anchors };
  }

  function restoreAnchors(html, anchors, translateFormulas = false, translatedFormulas = []) {
    let result = html;
    let formulaIndex = 0;
    let codeIndex = 0;

    // Restore formulas
    const formulaAnchorPattern = /(?:\[\[COF_FORMULA_\d+\]\]|<!--FORMULA_ANCHOR_\d+-->)/g;
    result = result.replace(formulaAnchorPattern, (match) => {
      const parsed = parseAnchor(match);
      if (!parsed || parsed.type !== "FORMULA") return match;

      const pos =
        anchors?.formulaPosByMarker && typeof anchors.formulaPosByMarker[match] === "number"
          ? anchors.formulaPosByMarker[match]
          : null;

      if (pos != null) {
        if (translateFormulas && translatedFormulas[pos]) return translatedFormulas[pos];
        return (anchors.formulas && anchors.formulas[pos]) || match;
      }

      // Fallback: legacy sequential restore
      if (translateFormulas && translatedFormulas[formulaIndex]) {
        const translated = translatedFormulas[formulaIndex];
        formulaIndex++;
        return translated;
      }
      const original = anchors.formulas[formulaIndex];
      formulaIndex++;
      return original || match;
    });

    // Restore code blocks
    const codeAnchorPattern = /(?:\[\[COF_CODE_\d+\]\]|<!--CODE_ANCHOR_\d+-->)/g;
    result = result.replace(codeAnchorPattern, (match) => {
      const parsed = parseAnchor(match);
      if (!parsed || parsed.type !== "CODE") return match;

      const pos =
        anchors?.codePosByMarker && typeof anchors.codePosByMarker[match] === "number"
          ? anchors.codePosByMarker[match]
          : null;

      if (pos != null) {
        return (anchors.codes && anchors.codes[pos]) || match;
      }

      // Fallback: legacy sequential restore
      const original = anchors.codes[codeIndex];
      codeIndex++;
      return original || match;
    });

    return result;
  }

  function extractAnchoredFormulas(anchors) {
    return anchors.formulas || [];
  }

  cof.anchor = {
    anchorFormulasAndCode,
    restoreAnchors,
    extractAnchoredFormulas,
    FORMULA_ANCHOR_PREFIX,
    CODE_ANCHOR_PREFIX,
  };
})();

