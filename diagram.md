# `extension/content-script.js` - Data/Control Flow

This diagram documents the runtime path from “user selects text” to “Office-compatible HTML is on the OS clipboard”.

## Components

```mermaid
flowchart TB
  subgraph Page["Web page"]
    SEL["User selection\n(window.getSelection)"]
  end

  subgraph CSW["Content-script world"]
    CS["content-script.js"]
    S["cof-selection.js\n(selection -> fragmentHtml via Range.cloneContents)"]
    W["cof-wasm.js\n(tex_to_mathml.wasm)"]
    X["cof-xslt.js\n(MathML -> OMML)"]
    C["cof-clipboard.js\n(writeHtml/writeText)"]
  end

  subgraph Ext["Extension runtime"]
    BG["background.js\n(Firefox MV2 / Chromium MV3 SW)"]
    OFF["offscreen.html + offscreen.js\n(Chromium MV3 clipboard writer)"]
  end

  subgraph Assets["Packaged assets"]
    WASM["wasm/tex_to_mathml.wasm"]
    XSL["assets/mathml2omml.xsl"]
  end

  subgraph OS["OS clipboard"]
    CLIP["Windows: HTML Format + CF_UNICODETEXT\n(and browser equivalents)"]
  end

  SEL --> CS
  CS --> S
  S -->|fragmentHtml| W
  W --> WASM
  CS --> X
  X --> XSL
  CS --> C
  C -->|try navigator.clipboard.write| CLIP
  C -->|fallback: runtime.sendMessage WRITE_CLIPBOARD| BG
  BG -->|Firefox MV2: navigator.clipboard.*| CLIP
  BG -->|Chromium MV3: OFFSCREEN_WRITE_CLIPBOARD| OFF
  OFF -->|navigator.clipboard.write| CLIP
```

## Entry points

```mermaid
flowchart LR
  BG["background.js\ncontextMenus.onClicked"] --> MSG["tabs.sendMessage\n{type:'COPY_OFFICE_FORMAT'|'COPY_AS_MARKDOWN'}"]
  TEST["Playwright tests\n(service worker -> tabs.sendMessage)"] --> MSG
  MSG --> CS["content-script.js\nruntime.onMessage"]
```

## Copy as Office (HTML) pipeline

```mermaid
sequenceDiagram
  autonumber
  participant BG as background.js
  participant CS as content-script.js
  participant S as cof-selection.js
  participant W as tex_to_mathml.wasm
  participant X as XSLTProcessor
  participant C as cof-clipboard.js
  participant CLIP as OS clipboard

  BG->>CS: COPY_OFFICE_FORMAT {mode:'html'}
  CS->>S: getSelectionHtmlAndText()
  S-->>CS: { html: fragmentHtml, text }
  CS->>W: html_to_office_with_mathml(fragmentHtml)
  W-->>CS: officeHtmlWithMathML
  CS->>X: convert <math> -> OMML (msEquation conditional comments)
  X-->>CS: wrappedHtml
  CS->>C: writeHtml({html: wrappedHtml, text})
  alt navigator.clipboard.write works
    C->>CLIP: write([ClipboardItem{text/html,text/plain}])
  else fallback
    C->>BG: WRITE_CLIPBOARD {mode:'html', html, text}
    BG->>CLIP: Firefox MV2 direct clipboard
    BG->>CLIP: Chromium MV3 via offscreen document
  end
  CS-->>BG: {ok:true|false, error?}
```

## Test verification (deterministic)

- Tests never rely on any “native selection copy” behavior.
- Tests trigger copy via the same `tabs.sendMessage` path and verify the real OS clipboard using `lib/tools/win_clipboard_dump.py`.

