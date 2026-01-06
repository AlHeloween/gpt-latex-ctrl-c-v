(() => {
  const cof = (globalThis.__cof = globalThis.__cof || {});
  const diag = cof.diag || (() => {});
  const core = cof.core || {};

  function fnv1a32Hex(s) {
    let hash = 0x811c9dc5;
    const str = String(s || "");
    for (let i = 0; i < str.length; i++) {
      hash ^= str.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash.toString(16).padStart(8, "0");
  }

  function truncateForDiag(s, maxLen = 200) {
    const str = String(s ?? "");
    return str.length > maxLen ? str.slice(0, maxLen) + "…" : str;
  }

  function sanitizeUrlForLog(url) {
    try {
      const u = new URL(String(url || ""));
      u.search = "";
      return u.toString();
    } catch (e) {
      return String(url || "");
    }
  }

  function dbg(stage, details) {
    try {
      const d =
        details && typeof details === "object"
          ? JSON.stringify(details)
          : String(details ?? "");
      diag("translationDebug", `${String(stage || "")} ${d}`.trim());
    } catch (e) {
      diag("translationDebug", `${String(stage || "")} [unserializable]`);
    }
  }

  async function fetchCompat(url, options) {
    const browserApi = core.browserApi || globalThis.browser || globalThis.chrome;
    const send = browserApi?.runtime?.sendMessage;

    if (typeof send === "function") {
      try {
        const r = await send({
          type: "COF_FETCH",
          url: String(url || ""),
          options: {
            method: options?.method,
            headers: options?.headers,
            body: options?.body,
            timeoutMs: options?.timeoutMs,
          },
        });
        if (r && typeof r.ok === "boolean") {
          const text = String(r.text || "");
          return {
            ok: !!r.ok,
            status: Number(r.status || 0),
            statusText: String(r.statusText || ""),
            headers: r.headers || {},
            text: async () => text,
            json: async () => JSON.parse(text),
          };
        }
      } catch (e) {
        dbg("fetchViaBackgroundError", { message: truncateForDiag(String(e?.message || e || "")) });
      }
    }

    // Fallback to direct fetch (may be blocked by CORS/permissions in some browsers).
    return fetch(url, options);
  }

  function _isInsideHtmlComment(s, pos) {
    const before = String(s || "").slice(0, Math.max(0, pos));
    const open = before.lastIndexOf("<!--");
    if (open < 0) return false;
    const close = before.lastIndexOf("-->");
    return close < open;
  }

  function _isInsideHtmlTag(s, pos) {
    const before = String(s || "").slice(0, Math.max(0, pos));
    const open = before.lastIndexOf("<");
    if (open < 0) return false;
    const close = before.lastIndexOf(">");
    return close < open;
  }

  function _isInsideCofSentinel(s, pos) {
    const before = String(s || "").slice(0, Math.max(0, pos));
    const open = before.lastIndexOf("[[COF_");
    if (open < 0) return false;
    const close = before.lastIndexOf("]]");
    return close < open;
  }

  function splitTextForTranslation(s, maxChars) {
    const text = String(s || "");
    const maxLen = Math.max(200, Number(maxChars) || 0);
    if (!text) return [""];
    if (text.length <= maxLen) return [text];

    const out = [];
    let i = 0;
    while (i < text.length) {
      let end = Math.min(text.length, i + maxLen);

      // Prefer to break near the end on "nice" boundaries.
      const windowStart = Math.max(i, end - Math.floor(maxLen * 0.5));
      const slice = text.slice(i, end);
      const preferred = ["\n\n", "\n", ". ", "? ", "! ", "; ", ", ", " ", ">"];
      let best = -1;
      for (const sep of preferred) {
        const idx = slice.lastIndexOf(sep);
        if (idx >= 0) {
          const candidate = i + idx + sep.length;
          if (candidate >= windowStart) {
            best = Math.max(best, candidate);
          }
        }
      }
      if (best > i) end = best;

      // Avoid splitting inside sentinels, <!-- ... -->, or <tag ...> fragments.
      let guard = 0;
      while (
        guard++ < 30 &&
        end > i &&
        (_isInsideCofSentinel(text, end) || _isInsideHtmlComment(text, end) || _isInsideHtmlTag(text, end))
      ) {
        // Prefer to back up to the opening token for whichever structure we're inside.
        let back = -1;
        if (_isInsideCofSentinel(text, end)) back = text.lastIndexOf("[[COF_", end - 1);
        else back = text.lastIndexOf("<", end - 1);

        if (back <= i) break;
        end = back;
      }

      if (end <= i) {
        // Fallback: force progress.
        end = Math.min(text.length, i + maxLen);
      }

      out.push(text.slice(i, end));
      i = end;
    }
    return out;
  }

  const SERVICE_MAX_CHARS = {
    // Conservative caps to avoid provider-side payload limits and 413s.
    // These are intentionally lower than many providers' true limits.
    "google-free": 4500, // handled via x-www-form-urlencoded POST
    google: 9000, // Google Translate v2 JSON
    "microsoft-free": 9000,
    microsoft: 9000,
    pollinations: 6000,
    chatgpt: 6000,
    gemini: 6000,
    custom: 9000,
  };

  function _maxCharsForService(service) {
    const k = String(service || "");
    const v = SERVICE_MAX_CHARS[k];
    return Number.isFinite(v) ? v : 6000;
  }

  function _extractAnchorMarkers(s) {
    const text = String(s || "");
    const re = /(?:\[\[COF_(?:FORMULA|CODE)_\d+\]\]|<!--(?:FORMULA|CODE)_ANCHOR_\d+-->)/g;
    return text.match(re) || [];
  }

  function _repairAnchorMarkers(input, output) {
    const expected = _extractAnchorMarkers(input);
    if (!expected.length) return { text: String(output || ""), removed: 0, changed: false };

    const expectedCounts = new Map();
    for (const m of expected) expectedCounts.set(m, (expectedCounts.get(m) || 0) + 1);

    const keptCounts = new Map();
    const re = /(?:\[\[COF_(?:FORMULA|CODE)_\d+\]\]|<!--(?:FORMULA|CODE)_ANCHOR_\d+-->)/g;
    let removed = 0;
    const out = String(output || "").replace(re, (m) => {
      const exp = expectedCounts.get(m) || 0;
      if (!exp) {
        removed += 1;
        return "";
      }
      const k = keptCounts.get(m) || 0;
      if (k >= exp) {
        removed += 1;
        return "";
      }
      keptCounts.set(m, k + 1);
      return m;
    });
    return { text: out, removed, changed: removed > 0 };
  }

  function _assertAnchorOrderPreserved(input, output, service) {
    const a = _extractAnchorMarkers(input);
    if (!a.length) return;
    const b = _extractAnchorMarkers(output);
    if (a.length !== b.length) {
      throw new Error(
        `translation integrity check failed: anchors count mismatch after repair (service=${String(service || "")}, expected=${a.length}, got=${b.length})`
      );
    }
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) {
        throw new Error(
          `translation integrity check failed: anchors order changed (service=${String(service || "")}, index=${i}, expected=${a[i]}, got=${b[i]})`
        );
      }
    }
  }

  function _assertAnchorsPreserved(input, output, service) {
    const a = _extractAnchorMarkers(input);
    if (!a.length) return;
    const b = _extractAnchorMarkers(output);

    const count = (arr) => {
      const m = new Map();
      for (const x of arr) m.set(x, (m.get(x) || 0) + 1);
      return m;
    };
    const ma = count(a);
    const mb = count(b);

    let ok = true;
    let missing = 0;
    let extra = 0;
    for (const [k, v] of ma.entries()) {
      const got = mb.get(k) || 0;
      if (got !== v) {
        ok = false;
        if (got < v) missing += v - got;
      }
    }
    for (const [k, v] of mb.entries()) {
      const exp = ma.get(k) || 0;
      if (exp !== v) {
        ok = false;
        if (v > exp) extra += v - exp;
      }
    }
    if (ok) return;

    // Never log content; only counts.
    const msg = `translation integrity check failed: anchors changed (service=${String(service || "")}, expected=${a.length}, got=${b.length}, missing=${missing}, extra=${extra})`;
    diag("translationIntegrityError", msg);
    throw new Error(msg);
  }

  async function _translateChunked({
    service,
    text,
    maxChars,
    translateOne,
    maxChunks,
    concurrency,
    onProgress,
  }) {
    const s = String(text || "");
    const limit = Math.max(200, Number(maxChars) || 0);
    if (s.length <= limit) return await translateOne(s, 1, 1);

    const chunks = splitTextForTranslation(s, limit);
    const cap = Math.max(1, Number(maxChunks) || 0);
    if (chunks.length > cap) {
      // Keep error short; content is sensitive and must not be logged.
      throw new Error(`${String(service || "translate")}: selection too large (${chunks.length} chunks). Reduce selection or use a keyed provider.`);
    }

    // Record as a non-console diagnostic (still inspectable via __cofLogs / dataset).
    diag(
      "translationChunking",
      JSON.stringify({
        service: String(service || ""),
        textLen: s.length,
        chunkCount: chunks.length,
        maxChars: limit,
      }),
    );

    const n = chunks.length;
    const conc = Math.max(1, Math.min(n, Number(concurrency) || 1));

    const results = new Array(n);
    let next = 0;
    let done = 0;
    let firstError = null;

    const report = (phase, i) => {
      try {
        if (typeof onProgress === "function") {
          onProgress({
            service: String(service || ""),
            phase: String(phase || ""),
            i: typeof i === "number" ? i : null,
            n,
            done,
          });
        }
      } catch (e) {
        diag("copyOfficeFormatNonFatalError", e);
      }
    };

    report("start", null);

    const worker = async () => {
      while (true) {
        if (firstError) return;
        const i = next;
        next += 1;
        if (i >= n) return;
        report("chunk-start", i + 1);
        try {
          const out = await translateOne(chunks[i], i + 1, n);
          results[i] = out;
          done += 1;
          report("chunk-done", i + 1);
        } catch (e) {
          firstError = e || new Error("translate chunk failed");
          report("error", i + 1);
          return;
        }
      }
    };

    await Promise.all(new Array(conc).fill(0).map(() => worker()));
    if (firstError) throw firstError;
    report("done", null);
    return results.join("");
  }

  async function translateWithGoogle(text, targetLang, apiKey) {
    try {
      const url = `https://translation.googleapis.com/language/translate/v2?key=${encodeURIComponent(apiKey)}`;
      dbg("googleRequest", {
        targetLang,
        textLen: String(text || "").length,
        textHash: fnv1a32Hex(text),
        url: sanitizeUrlForLog(url),
      });
      const response = await fetchCompat(url, {
        method: "POST",
        timeoutMs: 15000,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          q: text,
          target: targetLang,
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        dbg("googleResponse", { ok: false, status: response.status, error: truncateForDiag(error) });
        throw new Error(`Google Translate API error: ${response.status} ${error}`);
      }

      const data = await response.json();
      dbg("googleResponse", { ok: true, status: response.status });
      return data.data?.translations?.[0]?.translatedText || text;
    } catch (e) {
      diag("translateGoogleError", truncateForDiag(String(e)));
      throw e;
    }
  }

  async function translateWithMicrosoft(text, targetLang, apiKey, region) {
    try {
      const url = `https://api.cognitive.microsofttranslator.com/translate?api-version=3.0&to=${encodeURIComponent(targetLang)}`;
      dbg("microsoftRequest", {
        targetLang,
        region: region || "",
        textLen: String(text || "").length,
        textHash: fnv1a32Hex(text),
        url: sanitizeUrlForLog(url),
      });
      const headers = {
        "Ocp-Apim-Subscription-Key": apiKey,
        "Content-Type": "application/json",
      };
      // Region is required for some Azure resource setups; omit if unknown instead of sending "global".
      if (region && String(region).trim()) {
        headers["Ocp-Apim-Subscription-Region"] = String(region).trim();
      }
      const response = await fetchCompat(url, {
        method: "POST",
        timeoutMs: 15000,
        headers,
        // Microsoft expects { Text: "..." } (capital T)
        body: JSON.stringify([{ Text: String(text || "") }]),
      });

      if (!response.ok) {
        const error = await response.text();
        dbg("microsoftResponse", { ok: false, status: response.status, error: truncateForDiag(error) });
        throw new Error(`Microsoft Translator API error: ${response.status} ${error}`);
      }

      const data = await response.json();
      dbg("microsoftResponse", { ok: true, status: response.status });
      return data[0]?.translations?.[0]?.text || text;
    } catch (e) {
      diag("translateMicrosoftError", truncateForDiag(String(e)));
      throw e;
    }
  }

  async function translateWithGoogleFreeOnce(text, targetLang, chunkIndex, chunkCount) {
    try {
      // Google Translate free endpoint (supports POST; avoids URL-length 413 on large payloads).
      const url = "https://translate.googleapis.com/translate_a/single";
      const body = new URLSearchParams({
        client: "gtx",
        sl: "auto",
        tl: String(targetLang || ""),
        dt: "t",
        q: String(text || ""),
      }).toString();
      dbg("googleFreeRequest", {
        targetLang,
        chunkIndex: chunkCount ? chunkIndex : undefined,
        chunkCount: chunkCount ? chunkCount : undefined,
        textLen: String(text || "").length,
        textHash: fnv1a32Hex(text),
        url: sanitizeUrlForLog(url),
      });
      const response = await fetchCompat(url, {
        method: "POST",
        timeoutMs: 20000,
        headers: { "Content-Type": "application/x-www-form-urlencoded; charset=utf-8" },
        body,
      });

      if (!response.ok) {
        dbg("googleFreeResponse", { ok: false, status: response.status });
        throw new Error(`Google Translate free endpoint error: ${response.status}`);
      }

      const data = await response.json();
      dbg("googleFreeResponse", { ok: true, status: response.status });
      // Response format:
      // data[0] = list of segments: [ [translated, original, ...], ... ]
      // Some inputs are chunked into many segments. Join all translated segments.
      if (Array.isArray(data) && Array.isArray(data[0])) {
        let out = "";
        let segCount = 0;
        for (const seg of data[0]) {
          if (!Array.isArray(seg)) continue;
          const part = seg[0];
          if (typeof part !== "string") continue;
          out += part;
          segCount += 1;
        }
        dbg("googleFreeSegments", { segCount, outLen: out.length });
        if (out) return out;
      }
      return text;
    } catch (e) {
      diag("translateGoogleFreeError", truncateForDiag(String(e)));
      throw e;
    }
  }

  async function translateWithGoogleFree(text, targetLang) {
    const s = String(text || "");
    const maxChars = _maxCharsForService("google-free");
    return await _translateChunked({
      service: "google-free",
      text: s,
      maxChars,
      maxChunks: 40,
      translateOne: (chunk, i, n) => translateWithGoogleFreeOnce(chunk, targetLang, i, n),
      concurrency: 6,
      onProgress: null,
    });
  }

  // TWP-compatible Bing "free" auth token for Microsoft translation.
  // Source: https://edge.microsoft.com/translate/auth
  let _bingAuth = "";
  let _bingAuthAt = 0;
  async function _getBingAuth(force = false) {
    const now = Date.now();
    // Token is short-lived; refresh conservatively.
    if (!force && _bingAuth && now - _bingAuthAt < 9 * 60 * 1000) return _bingAuth;
    const url = "https://edge.microsoft.com/translate/auth";
    dbg("bingAuthRequest", { url: sanitizeUrlForLog(url) });
    const r = await fetchCompat(url, { method: "GET", timeoutMs: 15000, headers: {} });
    if (!r.ok) {
      dbg("bingAuthResponse", { ok: false, status: r.status });
      throw new Error(`Bing auth endpoint error: ${r.status}`);
    }
    const token = String(await r.text()).trim();
    if (!token) throw new Error("Bing auth token empty");
    _bingAuth = token;
    _bingAuthAt = now;
    dbg("bingAuthResponse", { ok: true, status: r.status, tokenLen: token.length });
    return token;
  }

  async function translateWithMicrosoftFree(text, targetLang) {
    try {
      // TWP uses:
      // - GET https://edge.microsoft.com/translate/auth  -> Bearer token
      // - POST https://api-edge.cognitive.microsofttranslator.com/translate?api-version=3.0...
      const base =
        "https://api-edge.cognitive.microsofttranslator.com/translate?api-version=3.0&includeSentenceLength=true";
      const url = `${base}&to=${encodeURIComponent(String(targetLang || ""))}`;
      const body = JSON.stringify([{ Text: String(text || "") }]);

      const doReq = async (auth) => {
        dbg("microsoftFreeRequest", {
          targetLang,
          textLen: String(text || "").length,
          textHash: fnv1a32Hex(text),
          url: sanitizeUrlForLog(url),
          authPresent: !!auth,
        });
        return await fetchCompat(url, {
          method: "POST",
          timeoutMs: 20000,
          headers: {
            Authorization: `Bearer ${auth}`,
            "Content-Type": "application/json",
          },
          body,
        });
      };

      let auth = await _getBingAuth(false);
      let response = await doReq(auth);
      if (!response.ok && (response.status === 401 || response.status === 403)) {
        // Token expired/invalid; refresh once.
        dbg("microsoftFreeRetryAuth", { status: response.status });
        auth = await _getBingAuth(true);
        response = await doReq(auth);
      }

      if (!response.ok) {
        const errText = await response.text();
        dbg("microsoftFreeResponse", { ok: false, status: response.status, error: truncateForDiag(errText) });
        throw new Error(`Microsoft (Bing) free endpoint error: ${response.status}`);
      }

      const data = await response.json();
      dbg("microsoftFreeResponse", { ok: true, status: response.status });
      return data[0]?.translations?.[0]?.text || text;
    } catch (e) {
      diag("translateMicrosoftFreeError", truncateForDiag(String(e)));
      throw e;
    }
  }

  async function translateWithChatGPT(text, targetLang, apiKey, embeddings, frequency) {
    try {
      const url = "https://api.openai.com/v1/chat/completions";
      const prompt = `Translate the following text to ${targetLang}. Preserve formatting, code blocks, and formulas. Only translate the text content, not code or formulas.\n\nText to translate:\n${text}`;
      dbg("chatgptRequest", {
        targetLang,
        textLen: String(text || "").length,
        textHash: fnv1a32Hex(text),
        url: sanitizeUrlForLog(url),
        apiKeyPresent: !!apiKey,
      });

      const response = await fetchCompat(url, {
        method: "POST",
        timeoutMs: 20000,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: "gpt-3.5-turbo",
          messages: [
            {
              role: "user",
              content: prompt,
            },
          ],
          temperature: 0.3,
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        dbg("chatgptResponse", { ok: false, status: response.status, error: truncateForDiag(error) });
        throw new Error(`ChatGPT API error: ${response.status} ${error}`);
      }

      const data = await response.json();
      dbg("chatgptResponse", { ok: true, status: response.status });
      return data.choices?.[0]?.message?.content || text;
    } catch (e) {
      diag("translateChatGPTError", truncateForDiag(String(e)));
      throw e;
    }
  }

  async function translateWithGemini(text, targetLang, apiKey, embeddings, frequency) {
    try {
      // Use gemini-1.5-flash (faster) or gemini-1.5-pro (more capable)
      // NOTE: Gemini model availability differs by API version; v1beta is required for some models.
      const model = "gemini-1.5-flash";
      const prompt = `Translate the following text to ${targetLang}. Preserve formatting, code blocks, and formulas. Only translate the text content, not code or formulas.\n\nText to translate:\n${text}`;

      const makeUrl = (apiVersion) =>
        `https://generativelanguage.googleapis.com/${apiVersion}/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;

      const body = JSON.stringify({
        contents: [
          {
            parts: [{ text: prompt }],
          },
        ],
      });

      const tryOnce = async (apiVersion) => {
        const url = makeUrl(apiVersion);
        dbg("geminiRequest", {
          targetLang,
          model,
          apiVersion,
          textLen: String(text || "").length,
          textHash: fnv1a32Hex(text),
          url: sanitizeUrlForLog(url),
          apiKeyPresent: !!apiKey,
        });
        const response = await fetchCompat(url, {
          method: "POST",
          timeoutMs: 20000,
          headers: { "Content-Type": "application/json" },
          body,
        });
        if (!response.ok) {
          const error = await response.text();
          dbg("geminiResponse", { ok: false, status: response.status, apiVersion, error: truncateForDiag(error) });
          throw new Error(`Gemini API error: ${response.status} ${error}`);
        }
        const data = await response.json();
        dbg("geminiResponse", { ok: true, status: response.status, apiVersion });
        return data.candidates?.[0]?.content?.parts?.[0]?.text || "";
      };

      // Prefer v1beta; fall back to v1 if needed for older deployments.
      try {
        const out = await tryOnce("v1beta");
        return out || text;
      } catch (e1) {
        const msg = String(e1?.message || e1 || "");
        if (msg.includes(" 404 ") || msg.includes("code\": 404") || msg.includes("is not found for API version")) {
          const out = await tryOnce("v1");
          return out || text;
        }
        throw e1;
      }
    } catch (e) {
      diag("translateGeminiError", truncateForDiag(String(e)));
      throw e;
    }
  }

	  async function translateWithPollinations(text, targetLang, apiKey, embeddings, frequency, customEndpoint) {
	    try {
      // Pollinations supports an OpenAI-compatible endpoint. Prefer the documented API gateway:
      //   https://gen.pollinations.ai/v1/chat/completions
      // (API keys are supported via Authorization header or ?key= query param).
      // For backward compatibility, fall back to the legacy text.pollinations.ai/openai endpoint
      // when no API key is configured.
	      const isKeyed = !!String(apiKey || "").trim();
	      const langLabel = (() => {
	        try {
	          const code = String(targetLang || "").trim();
	          if (!code) return "the target language";
          const dn = new Intl.DisplayNames(["en"], { type: "language" });
          const name = dn.of(code);
          return name && name.toLowerCase() !== code.toLowerCase() ? `${name} (${code})` : code;
        } catch (_e) {
          return String(targetLang || "").trim() || "the target language";
        }
      })();
      const system = [
        "You are a translation engine.",
        "Return ONLY the translation (no explanations, no notes, no analysis).",
        "Preserve whitespace and punctuation as much as possible.",
        "Do NOT change any HTML tags or attributes. Treat any <...> markup as immutable.",
        "Never change or remove any placeholders like [[COF_FORMULA_0]] or [[COF_CODE_0]].",
        "The output MUST be wrapped exactly as: <COF_OUT>...</COF_OUT>, and output nothing else.",
      ].join(" ");
      const markers = (() => {
        try {
          const m = String(text || "").match(/\[\[COF_(?:FORMULA|CODE)_\d+\]\]/g) || [];
          const uniq = Array.from(new Set(m));
          return uniq.slice(0, 50); // keep prompt bounded
        } catch (_e) {
          return [];
        }
      })();
	      const markerHint = markers.length
	        ? `\n\nCRITICAL: This input chunk contains placeholders that MUST appear verbatim in the output:\n${markers.join(" ")}\n`
	        : "";
	      const promptBase = `Translate the following text to ${langLabel}.${markerHint}\n<COF_IN>\n${text}\n</COF_IN>`;

      const normalizeUrl = (raw) => {
        const s = String(raw || "").trim();
        if (!s) return "";
        if (/^https?:\/\//i.test(s)) return s;
        return `https://${s}`;
      };

      const resolvePollinationsUrl = () => {
        const configured = normalizeUrl(customEndpoint);
        if (configured) {
          const lower = configured.toLowerCase();
          if (lower.includes("gen.pollinations.ai")) {
            if (lower.includes("/v1/chat/completions")) return configured;
            return configured.endsWith("/") ? `${configured}v1/chat/completions` : `${configured}/v1/chat/completions`;
          }
          if (lower.includes("/v1/chat/completions")) return configured;
          // Legacy behavior: treat any other endpoint as OpenAI-ish /openai.
          if (lower.includes("/openai")) return configured;
          return configured.endsWith("/") ? `${configured}openai` : `${configured}/openai`;
        }

        if (apiKey) return "https://gen.pollinations.ai/v1/chat/completions";
        return "https://text.pollinations.ai/openai";
      };
      const url = resolvePollinationsUrl();

      dbg("pollinationsRequest", {
        targetLang,
        textLen: String(text || "").length,
        textHash: fnv1a32Hex(text),
        url: sanitizeUrlForLog(url),
        apiKeyPresent: !!apiKey,
        customEndpointPresent: !!customEndpoint,
      });

      const headers = { "Content-Type": "application/json" };
      // Pollinations supports both header auth and query param auth. Prefer header.
      if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

	      const isGenGateway = (() => {
	        try {
	          const u = new URL(String(url || ""));
	          const host = String(u.hostname || "").toLowerCase();
          const path = String(u.pathname || "").toLowerCase();
          return host === "gen.pollinations.ai" || path.includes("/v1/chat/completions");
        } catch (_e) {
          const lower = String(url || "").toLowerCase();
          return lower.includes("gen.pollinations.ai") || lower.includes("/v1/chat/completions");
        }
	      })();

	      const strict = isKeyed || isGenGateway;

	      const extractCofOut = (s) => {
	        try {
	          const str = String(s || "");
          const open = str.indexOf("<COF_OUT>");
          const close = str.indexOf("</COF_OUT>");
          if (open >= 0 && close > open) {
            return str.slice(open + "<COF_OUT>".length, close).trim();
          }
          return "";
        } catch (_e) {
          return "";
        }
      };
	      const pickFromJson = (data) => {
	        const out =
	          data?.choices?.[0]?.message?.content ??
          data?.choices?.[0]?.text ??
          data?.choices?.[0]?.content ??
          data?.text ??
          data?.result ??
          data?.content ??
          data?.response;
	        if (typeof out !== "string") return "";
	        return out.trim();
	      };

	      const validateCofOut = (outText) => {
	        const out = String(outText || "");
	        const inputLen = String(text || "").length;
	        const trimmedOut = out.trim();

        // Refuse outputs that obviously leaked instructions/prompt wrappers.
        const forbidden = ["<COF_IN>", "</COF_IN>", "Translate the following text", "You are a translation engine"];
        for (const f of forbidden) {
          if (trimmedOut.includes(f)) {
            throw new Error("Pollinations response leaked prompt/instructions; refusing to apply translation");
          }
        }

        // Refuse placeholder/truncation outputs for non-trivial inputs.
	        if (inputLen >= 200) {
	          const minLen = Math.max(40, Math.floor(inputLen * 0.12));
	          if (trimmedOut === "..." || trimmedOut.length < minLen) {
	            const base = `Pollinations returned too-short output (inLen=${inputLen}, outLen=${trimmedOut.length})`;
	            throw new Error(strict ? `${base}. Configure an API key and use gen.pollinations.ai.` : base);
	          }
	        }
	        return trimmedOut;
	      };

	      const requireWrapped = (s) => {
	        const wrapped = extractCofOut(s);
	        if (wrapped) return validateCofOut(wrapped);
	        // Never accept wrapper-less output for Pollinations; it commonly leaks prompt/reasoning.
	        throw new Error("Pollinations response missing <COF_OUT> wrapper");
	      };

	      const requestOnce = async (attempt) => {
	        const system2 =
	          attempt >= 2 && !strict
	            ? [
	                system,
	                "If you cannot provide a full translation, return the input unchanged inside <COF_OUT>...</COF_OUT>.",
	                "Do NOT output '...' or summaries/truncations.",
	              ].join(" ")
	            : system;
	        const prompt2 =
	          attempt >= 2 && !strict
	            ? `${promptBase}\n\nREMINDER: Output must contain ALL input text (translated or unchanged) inside <COF_OUT>.`
	            : promptBase;

	        // The legacy text.pollinations.ai/openai proxy is stricter and doesn't accept all OpenAI params.
	        const body = isGenGateway
	          ? {
	              model: "openai",
	              response_format: { type: "text" },
	              reasoning_effort: "none",
	              thinking: { type: "disabled", budget_tokens: 1 },
	              temperature: 0,
	              messages: [
	                { role: "system", content: system2 },
	                { role: "user", content: prompt2 },
	              ],
	            }
	          : {
	              model: "openai",
	              temperature: 0,
	              messages: [
	                { role: "system", content: system2 },
	                { role: "user", content: prompt2 },
	              ],
	            };

	        const response = await fetchCompat(url, {
	          method: "POST",
	          timeoutMs: 30000,
	          headers,
	          body: JSON.stringify(body),
	        });

	        if (!response.ok) {
	          const error = await response.text();
	          dbg("pollinationsResponse", { ok: false, status: response.status, error: truncateForDiag(error), attempt });
	          throw new Error(`Pollinations API error: ${response.status} ${error.substring(0, 200)}`);
	        }

	        const raw = await response.text();
	        dbg("pollinationsResponse", { ok: true, status: response.status, responseLen: raw.length, attempt });
	        const trimmed = String(raw || "").trim();

	        // Best case: valid JSON response.
	        try {
	          const data = JSON.parse(trimmed);
	          const out = pickFromJson(data);
	          if (out) return requireWrapped(out);
	        } catch (_e) {
	          // Some pollinations responses have invalid JSON due to unescaped newlines in fields like reasoning_content.
	          // Do a conservative extraction of the first JSON-string value for known keys.
	          const extractJsonStringValue = (key) => {
	            try {
	              const re = new RegExp(`\"${key}\"\\s*:\\s*\"((?:\\\\.|[^\"\\\\])*)\"`, "i");
	              const m = re.exec(trimmed);
	              if (!m || !m[1]) return "";
	              // m[1] is the JSON string literal content (escapes preserved). Decode via JSON.parse.
	              return JSON.parse(`\"${m[1]}\"`).trim();
	            } catch (_e2) {
	              return "";
	            }
	          };
	          const outRaw =
	            extractJsonStringValue("content") ||
	            extractJsonStringValue("text") ||
	            extractJsonStringValue("result") ||
	            extractJsonStringValue("response");
	          if (outRaw) return requireWrapped(outRaw);

	          // If it looks like JSON but we can't extract a usable answer, fail fast.
	          if (trimmed.startsWith("{") && trimmed.includes("\"choices\"")) {
	            throw new Error("Pollinations returned unparseable JSON (no content/text field found)");
	          }
	        }

	        // Plain-text fallback (non-JSON endpoint or proxy).
	        return requireWrapped(trimmed);
	      };

	      if (strict) return await requestOnce(1);

	      // No-key legacy: best-effort. Retry once; if still unusable, keep content unchanged
	      // to avoid breaking copy/anchor restoration.
	      try {
	        return await requestOnce(1);
	      } catch (e1) {
	        dbg("pollinationsRetry", { attempt: 2, message: truncateForDiag(String(e1?.message || e1 || "")) });
	        try {
	          return await requestOnce(2);
	        } catch (e2) {
	          dbg("pollinationsFallbackToOriginal", { message: truncateForDiag(String(e2?.message || e2 || "")) });
	          return String(text || "");
	        }
	      }
	    } catch (e) {
	      diag("translatePollinationsError", truncateForDiag(String(e)));
	      throw e;
	    }
	  }

  async function translateWithCustomAPI(text, targetLang, config) {
    try {
      const { endpoint, method = "POST", headers = {}, payloadFormat = {} } = config;
      if (!endpoint) throw new Error("Custom API endpoint not configured");

      dbg("customRequest", {
        targetLang,
        method,
        endpoint: sanitizeUrlForLog(endpoint),
        textLen: String(text || "").length,
        textHash: fnv1a32Hex(text),
      });

      const body = payloadFormat.template
        ? payloadFormat.template.replace("{{text}}", text).replace("{{lang}}", targetLang)
        : JSON.stringify({ text, targetLang, ...payloadFormat });

      const response = await fetchCompat(endpoint, {
        method,
        timeoutMs: 20000,
        headers: { "Content-Type": "application/json", ...headers },
        body: method !== "GET" ? body : undefined,
      });

      if (!response.ok) {
        const error = await response.text();
        dbg("customResponse", { ok: false, status: response.status, error: truncateForDiag(error) });
        throw new Error(`Custom API error: ${response.status} ${error}`);
      }

      const data = await response.json();
      dbg("customResponse", { ok: true, status: response.status });
      return data.text || data.translatedText || data.result || text;
    } catch (e) {
      diag("translateCustomAPIError", truncateForDiag(String(e)));
      throw e;
    }
  }

  async function translateFormulas(formulas, service, apiKey, targetLang, customConfig) {
    if (!formulas || formulas.length === 0) return formulas;

    const translatedFormulas = [];
    for (const formula of formulas) {
      try {
        let translated;
        if (service === "chatgpt") {
          translated = await translateWithChatGPT(formula, targetLang, apiKey, null, null);
        } else if (service === "gemini") {
          translated = await translateWithGemini(formula, targetLang, apiKey, null, null);
        } else if (service === "pollinations") {
          translated = await translateWithPollinations(formula, targetLang, apiKey, null, null, customConfig?.endpoint);
        } else if (service === "custom") {
          translated = await translateWithCustomAPI(formula, targetLang, customConfig);
        } else {
          translated = formula; // Don't translate with Google/Microsoft
        }
        translatedFormulas.push(translated);
      } catch (e) {
        diag("translateFormulaError", String(e));
        translatedFormulas.push(formula); // Fallback to original
      }
    }
    return translatedFormulas;
  }

  async function translate(content, targetLang, service, config, embeddings, frequency, anchors, onProgress) {
    try {
      const { apiKeys, customApi, translateFormulas } = config;
      const apiKey = apiKeys[service] || "";
      const useWasm = !!config?.translation?.useWasm;
      const maxConcurrencyCfg = Number(config?.translation?.maxConcurrency) || 0;
      const defaultConcurrency =
        service === "pollinations" ? 1 : service === "chatgpt" || service === "gemini" || service === "custom" ? 3 : 6;
      let concurrency = Math.max(1, Math.min(12, maxConcurrencyCfg || defaultConcurrency));
      // Pollinations is rate-limited and does not allow parallel requests reliably.
      if (service === "pollinations") concurrency = 1;
      dbg("translateStart", {
        service,
        targetLang,
        contentLen: String(content || "").length,
        contentHash: fnv1a32Hex(content),
        apiKeyPresent: !!apiKey,
        wasmAvailable: !!(cof.translationWasm && cof.translationWasm.translateText),
        useWasm,
        concurrency,
      });

      // Try to use WASM translation module if available
      const translationWasm = cof.translationWasm;
      if (useWasm && translationWasm && translationWasm.translateText) {
        try {
          // Map service names to WASM service names
          let wasmService = service;
          if (service === "google-free" || service === "google") {
            wasmService = "google";
          } else if (service === "microsoft-free" || service === "microsoft") {
            wasmService = "bing";
          } else if (service === "chatgpt") {
            wasmService = "chatgpt";
          } else if (service === "gemini") {
            wasmService = "gemini";
          } else if (service === "pollinations") {
            wasmService = "pollinations";
          } else if (service === "custom") {
            wasmService = "custom";
          }
          
          // Set API key if provided
          if (apiKey && translationWasm.setApiKey) {
            translationWasm.setApiKey(wasmService, apiKey);
          }
          
          // Set custom service config if provided
          if (service === "custom" && customApi && translationWasm.setCustomService) {
            translationWasm.setCustomService(customApi);
          }
          
          // Use WASM translation
          const sourceLang = "auto"; // Auto-detect source language
          const out = await translationWasm.translateText(wasmService, sourceLang, targetLang, content);
          dbg("translateWasmOk", { wasmService, outLen: String(out || "").length, outHash: fnv1a32Hex(out) });
          return out;
        } catch (wasmError) {
          diag("translateWasmFallback", String(wasmError?.message || wasmError || ""));
          dbg("translateWasmFallback", { message: truncateForDiag(String(wasmError?.message || wasmError || "")) });
          // Fall through to legacy implementation
        }
      }

      // Google and Microsoft can work without API keys using free endpoints
      if (!apiKey && service !== "pollinations" && service !== "google" && service !== "microsoft" && service !== "google-free" && service !== "microsoft-free") {
        throw new Error(`API key not configured for ${service}`);
      }

      let translated;

      switch (service) {
        case "google-free":
          translated = await _translateChunked({
            service: "google-free",
            text: content,
            maxChars: _maxCharsForService("google-free"),
            maxChunks: 40,
            translateOne: (chunk, i, n) => translateWithGoogleFreeOnce(chunk, targetLang, i, n),
            concurrency,
            onProgress,
          });
          break;
        case "google":
          if (!apiKey) {
            translated = await _translateChunked({
              service: "google-free",
              text: content,
              maxChars: _maxCharsForService("google-free"),
              maxChunks: 40,
              translateOne: (chunk, i, n) => translateWithGoogleFreeOnce(chunk, targetLang, i, n),
              concurrency,
              onProgress,
            });
            break;
          }
          translated = await _translateChunked({
            service: "google",
            text: content,
            maxChars: _maxCharsForService("google"),
            maxChunks: 60,
            translateOne: (chunk) => translateWithGoogle(chunk, targetLang, apiKey),
            concurrency,
            onProgress,
          });
          break;
        case "microsoft-free":
          translated = await _translateChunked({
            service: "microsoft-free",
            text: content,
            maxChars: _maxCharsForService("microsoft-free"),
            maxChunks: 60,
            translateOne: (chunk) => translateWithMicrosoftFree(chunk, targetLang),
            concurrency,
            onProgress,
          });
          break;
        case "microsoft":
          if (!apiKey) {
            translated = await _translateChunked({
              service: "microsoft-free",
              text: content,
              maxChars: _maxCharsForService("microsoft-free"),
              maxChunks: 60,
              translateOne: (chunk) => translateWithMicrosoftFree(chunk, targetLang),
              concurrency,
              onProgress,
            });
            break;
          }
          translated = await _translateChunked({
            service: "microsoft",
            text: content,
            maxChars: _maxCharsForService("microsoft"),
            maxChunks: 60,
            translateOne: (chunk) => translateWithMicrosoft(chunk, targetLang, apiKey, customApi.region),
            concurrency,
            onProgress,
          });
          break;
        case "chatgpt":
          translated = await _translateChunked({
            service: "chatgpt",
            text: content,
            maxChars: _maxCharsForService("chatgpt"),
            maxChunks: 80,
            translateOne: (chunk) => translateWithChatGPT(chunk, targetLang, apiKey, embeddings, frequency),
            concurrency,
            onProgress,
          });
          break;
        case "gemini":
          translated = await _translateChunked({
            service: "gemini",
            text: content,
            maxChars: _maxCharsForService("gemini"),
            maxChunks: 80,
            translateOne: (chunk) => translateWithGemini(chunk, targetLang, apiKey, embeddings, frequency),
            concurrency,
            onProgress,
          });
          break;
        case "pollinations":
          // No-key Pollinations (legacy endpoint) is much more likely to truncate/return "..."
          // on large chunks. Use smaller chunks so outputs fit within service limits.
          // With an API key (gen.pollinations.ai), keep the larger chunk size.
          const pollinationsMaxChars = apiKey ? _maxCharsForService("pollinations") : 1500;
          const pollinationsMaxChunks = apiKey ? 80 : 120;
          translated = await _translateChunked({
            service: "pollinations",
            text: content,
            maxChars: pollinationsMaxChars,
            maxChunks: pollinationsMaxChunks,
            translateOne: (chunk) => translateWithPollinations(chunk, targetLang, apiKey, embeddings, frequency, customApi.endpoint),
            concurrency,
            onProgress,
          });
          break;
        case "custom":
          translated = await _translateChunked({
            service: "custom",
            text: content,
            maxChars: _maxCharsForService("custom"),
            maxChunks: 80,
            translateOne: (chunk) => translateWithCustomAPI(chunk, targetLang, customApi),
            concurrency,
            onProgress,
          });
          break;
        default:
          throw new Error(`Unknown translation service: ${service}`);
      }

      // Integrity: translation must preserve anchor markers verbatim, otherwise formulas/code restoration breaks.
      const llmServices = new Set(["pollinations", "chatgpt", "gemini", "custom"]);
      if (llmServices.has(String(service || ""))) {
        const repaired = _repairAnchorMarkers(content, translated);
        if (repaired.changed) {
          dbg("anchorRepair", { removed: repaired.removed, service });
          translated = repaired.text;
        }
        _assertAnchorOrderPreserved(content, translated, service);
      }
      _assertAnchorsPreserved(content, translated, service);

      return translated;
    } catch (e) {
      diag("translateError", truncateForDiag(String(e)));
      throw e;
    }
  }

  cof.translate = {
    translate,
    translateWithGoogle,
    translateWithGoogleFree,
    translateWithMicrosoft,
    translateWithMicrosoftFree,
    translateWithChatGPT,
    translateWithGemini,
    translateWithPollinations,
    translateWithCustomAPI,
    translateFormulas,
  };
})();

