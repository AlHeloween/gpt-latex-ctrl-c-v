/**
 * Deterministic unit test: selection multi-range dedupe.
 *
 * Some pages can produce many identical/overlapping selection ranges. If we
 * append cloneContents() for each range, content can be duplicated N times.
 *
 * This test simulates a Selection with many identical ranges and verifies
 * we only serialize the selection once (strategy = best-range).
 *
 * Run:
 *   node tests/test_selection_multirange_dedupe.js
 */

const { JSDOM } = require("jsdom");
const fs = require("fs");
const path = require("path");

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function main() {
  const dom = new JSDOM("<!doctype html><html><body><div id='c'></div></body></html>", {
    url: "http://localhost",
    pretendToBeVisual: true,
  });
  global.window = dom.window;
  global.document = dom.window.document;
  global.Range = dom.window.Range;

  // Build content with a unique token.
  const token = "TOKEN_SELECTION_MULTI_RANGE_ABC123";
  const c = document.getElementById("c");
  c.innerHTML = `<p>A ${token} B</p><p>Second para</p>`;

  const baseRange = document.createRange();
  baseRange.selectNodeContents(c);

  // Fake selection that exposes many identical ranges (a common duplication failure mode).
  const fakeSel = {
    rangeCount: 50,
    isCollapsed: false,
    getRangeAt: () => baseRange,
    toString: () => baseRange.toString(),
    removeAllRanges: () => {},
    addRange: () => {},
  };
  window.getSelection = () => fakeSel;

  global.__cof = {
    diag: () => {},
    core: { root: document.documentElement },
  };

  const selectionPath = path.join(__dirname, "..", "extension", "lib", "cof-selection.js");
  const code = fs.readFileSync(selectionPath, "utf8");
  // eslint-disable-next-line no-eval
  eval(code);

  const selection = global.__cof.selection;
  assert(selection && selection.getSelectionHtmlAndText, "cof.selection not loaded");

  const out = selection.getSelectionHtmlAndText();
  assert(out && typeof out.html === "string", "missing html result");

  const count = (out.html.match(new RegExp(token, "g")) || []).length;
  assert(count === 1, `expected token once (deduped), got ${count}`);

  const ds = document.documentElement.dataset;
  assert(ds.copyOfficeFormatSelectionRangeCount === "50", "rangeCount dataset missing");
  assert(ds.copyOfficeFormatSelectionUsedRangeCount === "1", "usedRangeCount should be 1");
  assert(
    ds.copyOfficeFormatSelectionUsedRangeStrategy === "best-range" ||
      ds.copyOfficeFormatSelectionUsedRangeStrategy === "single",
    `unexpected strategy: ${ds.copyOfficeFormatSelectionUsedRangeStrategy}`,
  );

  console.log("OK: selection multi-range dedupe test passed");
}

main().catch((e) => {
  console.error("FAIL:", e && e.stack ? e.stack : String(e));
  process.exit(1);
});

