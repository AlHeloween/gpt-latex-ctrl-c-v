/**
 * Deterministic unit test: anchor restore must not depend on marker order.
 *
 * Simulates a translator reordering markers while keeping them intact.
 */

const fs = require("fs");
const path = require("path");

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function main() {
  global.__cof = { diag: () => {} };

  const anchorPath = path.join(__dirname, "..", "extension", "lib", "cof-anchor.js");
  const code = fs.readFileSync(anchorPath, "utf8");
  // eslint-disable-next-line no-eval
  eval(code);

  const anchor = global.__cof.anchor;
  assert(anchor && anchor.anchorFormulasAndCode && anchor.restoreAnchors, "anchor module not loaded");

  const original =
    "<p>A <math><mi>x</mi></math> B <pre><code>print('hi')</code></pre> C</p>";
  const { html: anchored, anchors } = anchor.anchorFormulasAndCode(original);

  // Expect we have one formula + one code.
  assert((anchors.formulas || []).length === 1, "expected 1 formula");
  assert((anchors.codes || []).length === 1, "expected 1 code");

  // Now simulate translation output that moved the CODE marker before the FORMULA marker.
  const formulaMarker = anchored.match(/\[\[COF_FORMULA_\d+\]\]/)?.[0] || "";
  const codeMarker = anchored.match(/\[\[COF_CODE_\d+\]\]/)?.[0] || "";
  assert(formulaMarker && codeMarker, "missing markers in anchored html");

  const reordered = anchored
    .replace(formulaMarker, "__TMP_FORMULA__")
    .replace(codeMarker, formulaMarker)
    .replace("__TMP_FORMULA__", codeMarker);

  const restored = anchor.restoreAnchors(reordered, anchors, false);
  assert(restored.includes("<math>"), "restored must include math");
  assert(restored.includes("<pre>"), "restored must include pre");
  assert(restored.includes("print('hi')"), "restored must include code body");
  // Crucially, C must still be present after restoration.
  assert(restored.includes("> C</p>") || restored.includes(" C</p>"), "restored must keep trailing text");

  console.log("OK: anchor restore marker-order test passed");
}

main().catch((e) => {
  console.error("FAIL:", e && e.stack ? e.stack : String(e));
  process.exit(1);
});
