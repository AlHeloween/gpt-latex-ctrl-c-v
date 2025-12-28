(() => {
const browserApi = globalThis.browser ?? globalThis.chrome;
const IS_TEST = (() => {
try {
const p = String(location?.protocol || "");
const h = String(location?.hostname || "");
return p === "file:" || h === "127.0.0.1" || h === "localhost" || h === "";
} catch {
return false;
}
})();
const root = document?.documentElement;
if (root?.dataset) {
root.dataset.copyOfficeFormatExtensionLoaded = "true";
}
let lastClipboardPayload = null;
function ensureTestBridge() {
if (!IS_TEST || !document?.documentElement) return null;
let el = document.getElementById("__copyOfficeFormatTestBridge");
if (!el) {
el = document.createElement("textarea");
el.id = "__copyOfficeFormatTestBridge";
el.style.cssText = "position:fixed;left:-9999px;top:-9999px;width:1px;height:1px;opacity:0;";
document.documentElement.appendChild(el);
}
return el;
}
function updateTestBridge() {
const el = ensureTestBridge();
if (!el) return;
try {
el.value = JSON.stringify({ lastClipboard: lastClipboardPayload });
} catch {
}
}
function useRealClipboard() {
try {
return !IS_TEST || String(root?.dataset?.copyOfficeFormatRealClipboard || "").toLowerCase() === "true";
} catch {
return true;
}
}
// Note: provide fragment-only HTML to "text/html" (no CF_HTML headers, no <html>/<body> wrapper,
// no StartFragment markers). The browser/OS clipboard layer can translate to platform formats.
async function writeClipboardHtmlCf({ cfhtml, plainText }) {
if (useRealClipboard() && navigator?.clipboard?.write && typeof ClipboardItem !== "undefined") {
try {
await navigator.clipboard.write([
new ClipboardItem({
"text/html": new Blob([cfhtml], { type: "text/html" }),
"text/plain": new Blob([plainText || ""], { type: "text/plain" }),
}),
]);
return;
} catch {
}
}
lastClipboardPayload = lastClipboardPayload || {};
updateTestBridge();
await new Promise((resolve, reject) => {
try {
const onCopy = (e) => {
try {
const cd = e?.clipboardData;
if (!cd) throw new Error("clipboardData unavailable");
cd.setData("text/plain", String(plainText || ""));
cd.setData("text/html", String(cfhtml || ""));
e.preventDefault();
resolve(true);
} catch (err) {
reject(err);
}
};
document.addEventListener("copy", onCopy, { capture: true, once: true });
const ok = document.execCommand("copy");
if (!ok) reject(new Error("execCommand('copy') returned false"));
} catch (err) {
reject(err);
}
});
}
async function writeClipboardText(text) {
const t = String(text || "");
if (useRealClipboard() && navigator?.clipboard?.writeText) {
try {
await navigator.clipboard.writeText(t);
return;
} catch {
}
}
await new Promise((resolve, reject) => {
try {
const onCopy = (e) => {
try {
const cd = e?.clipboardData;
if (!cd) throw new Error("clipboardData unavailable");
cd.setData("text/plain", t);
e.preventDefault();
resolve(true);
} catch (err) {
reject(err);
}
};
document.addEventListener("copy", onCopy, { capture: true, once: true });
const ok = document.execCommand("copy");
if (!ok) reject(new Error("execCommand('copy') returned false"));
} catch (err) {
reject(err);
}
});
}
let wasmP = null;
async function wasm() {
if (wasmP) return wasmP;
wasmP = (async () => {
if (!browserApi?.runtime?.getURL) throw new Error("runtime.getURL missing");
const url = browserApi.runtime.getURL("wasm/tex_to_mathml.wasm");
const r = await fetch(url);
if (!r.ok) throw new Error(`wasm fetch failed: ${r.status}`);
const { instance } = await WebAssembly.instantiate(await r.arrayBuffer(), {});
const e = instance.exports || {};
if (e.api_version && e.api_version() !== 3) throw new Error(`wasm api_version mismatch: ${e.api_version()}`);
return { e, mem: e.memory };
})();
return wasmP;
}
function forceWasmMath() {
try {
return String(root?.dataset?.copyOfficeFormatForceWasm || "").toLowerCase() === "true";
} catch {
return false;
}
}
function wasmCall1(w, fn, s) {
const e = w.e;
const enc = new TextEncoder();
const bytes = enc.encode(String(s || ""));
const ptr = e.alloc(bytes.length);
new Uint8Array(w.mem.buffer, ptr, bytes.length).set(bytes);
const outPtr = e[fn](ptr, bytes.length);
e.dealloc(ptr, bytes.length);
if (!outPtr) throw new Error(wasmLastError(w));
const outLen = e.last_len();
const out = new TextDecoder("utf-8").decode(new Uint8Array(w.mem.buffer, outPtr, outLen));
e.dealloc(outPtr, outLen);
return out;
}
function wasmCallTex(w, latex, display) {
const e = w.e;
const enc = new TextEncoder();
const bytes = enc.encode(String(latex || ""));
const ptr = e.alloc(bytes.length);
new Uint8Array(w.mem.buffer, ptr, bytes.length).set(bytes);
const outPtr = e.tex_to_mathml(ptr, bytes.length, display ? 1 : 0);
e.dealloc(ptr, bytes.length);
if (!outPtr) throw new Error(wasmLastError(w));
const outLen = e.last_len();
const out = new TextDecoder("utf-8").decode(new Uint8Array(w.mem.buffer, outPtr, outLen));
e.dealloc(outPtr, outLen);
return out;
}
function wasmCall2(w, fn, a, b) {
const e = w.e;
const enc = new TextEncoder();
const aBytes = enc.encode(String(a || ""));
const bBytes = enc.encode(String(b || ""));
const aPtr = e.alloc(aBytes.length);
const bPtr = e.alloc(bBytes.length);
new Uint8Array(w.mem.buffer, aPtr, aBytes.length).set(aBytes);
new Uint8Array(w.mem.buffer, bPtr, bBytes.length).set(bBytes);
const outPtr = e[fn](aPtr, aBytes.length, bPtr, bBytes.length);
e.dealloc(aPtr, aBytes.length);
e.dealloc(bPtr, bBytes.length);
if (!outPtr) throw new Error(wasmLastError(w));
const outLen = e.last_len();
const out = new TextDecoder("utf-8").decode(new Uint8Array(w.mem.buffer, outPtr, outLen));
e.dealloc(outPtr, outLen);
return out;
}
function wasmLastError(w) {
try {
const e = w.e;
const ptr = e.last_err_ptr();
const len = e.last_err_len();
if (!ptr || !len) return "wasm error";
const msg = new TextDecoder("utf-8").decode(new Uint8Array(w.mem.buffer, ptr, len));
e.dealloc(ptr, len);
e.clear_last_error();
return msg || "wasm error";
} catch {
return "wasm error";
}
}
function setSelectionToSelector(selector) {
const sel = window.getSelection();
if (!sel) return { ok: false, error: "no-selection-api" };
const target = selector ? document.querySelector(selector) : null;
if (root?.dataset) {
root.dataset.copyOfficeFormatTestSelector = selector || "";
root.dataset.copyOfficeFormatTestSelectorFound = target ? "true" : "false";
}
const el = target || document.body;
if (!el) return { ok: false, error: "no-body" };
const r = document.createRange();
r.selectNodeContents(el);
sel.removeAllRanges();
sel.addRange(r);
return { ok: true };
}
function getSelectionHtmlAndText() {
const sel = window.getSelection();
if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return { html: "", text: "" };
const text = sel.toString() || "";
if (isSelectionSourceDoc()) {
if (root?.dataset) root.dataset.copyOfficeFormatSelectionSourceDocDetected = "true";
const bodyTxt = String(document?.body?.textContent || "");
const useBody = bodyTxt && text && text.length < Math.floor(bodyTxt.length * 0.8);
const extracted = extractHtmlFromSelectionSource(useBody ? bodyTxt : text);
if (extracted) return { html: extracted, text };
}
const ranges = [];
for (let i = 0; i < sel.rangeCount; i++) ranges.push(sel.getRangeAt(i).cloneRange());
try {
const markers = [];
const pairs = [];
for (let i = ranges.length - 1; i >= 0; i--) {
const id = `${Date.now()}-${Math.random().toString(16).slice(2)}-${i}`;
const startTok = `COF_START_${id}`;
const endTok = `COF_END_${id}`;
const startNode = document.createComment(startTok);
const endNode = document.createComment(endTok);
const rEnd = ranges[i].cloneRange();
rEnd.collapse(false);
rEnd.insertNode(endNode);
const rStart = ranges[i].cloneRange();
rStart.collapse(true);
rStart.insertNode(startNode);
markers.push(startNode, endNode);
pairs.push([startTok, endTok]);
}
const pageHtml = document.documentElement ? document.documentElement.outerHTML : "";
for (const n of markers) {
try {
if (n && n.parentNode) n.parentNode.removeChild(n);
} catch {
}
}
return { html: pageHtml, text, pairs };
} catch {
const div = document.createElement("div");
for (let i = 0; i < ranges.length; i++) {
div.appendChild(ranges[i].cloneContents());
if (i + 1 < ranges.length) div.appendChild(document.createTextNode(" "));
}
return { html: div.innerHTML || "", text };
}
}
function isSelectionSourceDoc() {
try {
const bodyId = String(document?.body?.id || "").toLowerCase();
const title = String(document?.title || "").toLowerCase();
return bodyId === "viewsource" || title.includes("dom source of selection");
} catch {
return false;
}
}
function extractHtmlFromSelectionSource(text) {
const s = String(text || "");
const idx = s.search(/<(?!!--)[A-Za-z!/]/);
return idx >= 0 ? s.slice(idx).trim() : "";
}
let xsltP = null;
async function xsltDoc() {
if (xsltP) return xsltP;
xsltP = (async () => {
const url = browserApi.runtime.getURL("assets/mathml2omml.xsl");
const r = await fetch(url);
if (!r.ok) throw new Error(`xslt fetch failed: ${r.status}`);
const txt = await r.text();
const doc = new DOMParser().parseFromString(txt, "application/xml");
if (doc.querySelector("parsererror")) throw new Error("xslt parse error");
return doc;
})();
return xsltP;
}
function stripMathmlAnnotations(mathml) {
return String(mathml || "").replace(/<annotation\b[\s\S]*?<\/annotation>/gi, "");
}
async function convertMathmlToOmmlInHtmlString(htmlString) {
if (!htmlString || typeof XSLTProcessor === "undefined") return String(htmlString || "");
let xslt;
try {
xslt = await xsltDoc();
} catch {
return String(htmlString || "");
}
const proc = new XSLTProcessor();
proc.importStylesheet(xslt);
const reMath = /<math\b[\s\S]*?<\/math>/gi;
const parts = [];
let last = 0;
let m;
while ((m = reMath.exec(htmlString))) {
const raw = m[0];
const match = stripMathmlAnnotations(raw);
parts.push(htmlString.slice(last, m.index));
last = m.index + raw.length;
let wrapped = match;
try {
const mathmlDoc = new DOMParser().parseFromString(match, "application/xml");
if (!mathmlDoc.querySelector("parsererror")) {
const ommlDoc = proc.transformToDocument(mathmlDoc);
if (ommlDoc?.documentElement) {
const omml = new XMLSerializer().serializeToString(ommlDoc.documentElement);
const isBlock = /\bdisplay\s*=\s*["']block["']/i.test(match);
const style = isBlock ? "mso-element:omath; display:block;" : "mso-element:omath; display:inline-block;";
const ms = `<!--[if gte msEquation 12]>${omml}<![endif]-->`;
const fb = `<![if !msEquation]>${match}<![endif]>`;
wrapped = `<span style="${style}">${ms}${fb}</span>`;
}
}
} catch {
}
parts.push(wrapped);
}
parts.push(htmlString.slice(last));
return parts.join("");
}
async function copyOfficeFromHtmlSelection() {
const got = getSelectionHtmlAndText();
const text = got.text;
if (root?.dataset) root.dataset.copyOfficeFormatTestSelectionLength = String((text || "").length);
if (!String(text || "").trim()) throw new Error("no selection");
const w = await wasm();
let html = got.html || "";
if (Array.isArray(got.pairs) && got.pairs.length > 0 && html) {
const frags = [];
for (let i = got.pairs.length - 1; i >= 0; i--) {
const p = got.pairs[i];
const tokens = `${p[0]}\u001F${p[1]}`;
try {
frags.push(wasmCall2(w, "extract_fragment_by_comment_tokens", html, tokens));
} catch {
}
}
html = frags.reverse().filter(Boolean).join("");
}
if (!html) throw new Error("no selection html");
if (forceWasmMath()) {
let htmlWithMath = String(html);
htmlWithMath = htmlWithMath.replace(/\$\$([\s\S]+?)\$\$/g, (m, inner) => {
try {
return wasmCallTex(w, String(inner || "").trim(), true);
} catch {
return m;
}
});
htmlWithMath = htmlWithMath.replace(/\$([^$\n]+?)\$/g, (m, inner) => {
try {
return wasmCallTex(w, String(inner || "").trim(), false);
} catch {
return m;
}
});
const officeHtml = wasmCall1(w, "html_to_office", htmlWithMath);
const wrappedHtml = await convertMathmlToOmmlInHtmlString(officeHtml);
const cfhtml = wrappedHtml;
lastClipboardPayload = { plainText: text, wrappedHtml, cfhtml };
updateTestBridge();
await writeClipboardHtmlCf({ cfhtml, plainText: text });
return true;
}
const prepared = JSON.parse(wasmCall1(w, "html_to_office_prepared", html));
const jobs = Array.isArray(prepared.jobs) ? prepared.jobs : [];
const mathml = jobs.map((j) => {
try {
return j?.latex ? wasmCallTex(w, String(j.latex || ""), !!j.display) : "";
} catch {
return "";
}
});
const joined = mathml.join("\u001F");
const withMath = joined ? wasmCall2(w, "office_apply_mathml", prepared.html || "", joined) : String(prepared.html || "");
const wrappedHtml = await convertMathmlToOmmlInHtmlString(withMath);
const cfhtml = wrappedHtml;
lastClipboardPayload = { plainText: text, wrappedHtml, cfhtml };
updateTestBridge();
await writeClipboardHtmlCf({ cfhtml, plainText: text });
return true;
}
async function copyOfficeFromMarkdownSelection() {
const { text } = getSelectionHtmlAndText();
if (!String(text || "").trim()) throw new Error("no selection");
const w = await wasm();
const prepared = JSON.parse(wasmCall1(w, "markdown_to_office_prepared", text));
const jobs = Array.isArray(prepared.jobs) ? prepared.jobs : [];
const mathml = jobs.map((j) => {
try {
return j?.latex ? wasmCallTex(w, String(j.latex || ""), !!j.display) : "";
} catch {
return "";
}
});
const joined = mathml.join("\u001F");
const withMath = joined ? wasmCall2(w, "office_apply_mathml", prepared.html || "", joined) : String(prepared.html || "");
const wrappedHtml = await convertMathmlToOmmlInHtmlString(withMath);
const cfhtml = wrappedHtml;
lastClipboardPayload = { plainText: text, wrappedHtml, cfhtml };
updateTestBridge();
await writeClipboardHtmlCf({ cfhtml, plainText: text });
return true;
}
async function copyAsMarkdown() {
const got = getSelectionHtmlAndText();
let html = got.html || "";
const text = got.text;
if (!String(text || "").trim()) throw new Error("no selection");
const w = await wasm();
if (Array.isArray(got.pairs) && got.pairs.length > 0 && html) {
const frags = [];
for (let i = got.pairs.length - 1; i >= 0; i--) {
const p = got.pairs[i];
const tokens = `${p[0]}\u001F${p[1]}`;
try {
frags.push(wasmCall2(w, "extract_fragment_by_comment_tokens", html, tokens));
} catch {
}
}
html = frags.reverse().filter(Boolean).join("");
}
const md = html ? wasmCall1(w, "html_to_markdown", html) : text;
lastClipboardPayload = { plainText: md, wrappedHtml: "", cfhtml: "" };
updateTestBridge();
await writeClipboardText(md);
return true;
}
async function handleCopyRequest(mode) {
if (mode === "markdown-export") return copyAsMarkdown();
if (mode === "markdown") return copyOfficeFromMarkdownSelection();
return copyOfficeFromHtmlSelection();
}
if (browserApi?.runtime?.onMessage?.addListener) {
browserApi.runtime.onMessage.addListener((msg) => {
const t = msg?.type;
if (t === "COPY_AS_MARKDOWN") return handleCopyRequest("markdown-export").then(() => ({ ok: true })).catch((e) => ({ ok: false, error: String(e?.message || e) }));
if (t === "COPY_OFFICE_FORMAT") return handleCopyRequest(msg?.mode || "html").then(() => ({ ok: true })).catch((e) => ({ ok: false, error: String(e?.message || e) }));
return false;
});
}
if (IS_TEST && window?.addEventListener) {
window.addEventListener("__copyOfficeFormatTestRequest", (ev) => {
const d = ev?.detail || {};
const requestId = d.requestId || null;
const selector = d.selector || null;
const mode = d.mode || "html";
(async () => {
try {
if (selector) setSelectionToSelector(selector);
await handleCopyRequest(mode);
window.dispatchEvent(new CustomEvent("__copyOfficeFormatTestResult", { detail: { requestId, ok: true } }));
} catch (e) {
try {
if (root?.dataset) root.dataset.copyOfficeFormatLastCopyError = String(e?.message || e);
} catch {
}
window.dispatchEvent(new CustomEvent("__copyOfficeFormatTestResult", { detail: { requestId, ok: false, error: String(e?.message || e) } }));
}
})();
});
}
})();
