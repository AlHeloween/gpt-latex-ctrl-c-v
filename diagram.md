# `extension/content-script.js` - Data/Control Flow

> **Note:** These Mermaid diagrams may not render in Cursor's markdown preview. They work in:
> - Chat/Plan Mode (inline rendering)
> - [Mermaid Live Editor](https://mermaid.live/) (copy/paste diagram code)
> - GitHub (when viewing on GitHub)
> - VS Code with Mermaid extension

This diagram documents the runtime path from "user selects text" to "Office-compatible HTML is on the OS clipboard".

## Components

```mermaid
flowchart TB
  subgraph Page["Web page"]
    SEL["User selection"]
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
  BG -->|Firefox MV2 clipboard| CLIP
  BG -->|Chromium MV3: OFFSCREEN_WRITE_CLIPBOARD| OFF
  OFF -->|navigator.clipboard.write| CLIP
```

## Entry points

```mermaid
flowchart LR
  BG["background.js\ncontextMenus.onClicked"] --> MSG["tabs.sendMessage\nCOPY_OFFICE_FORMAT or COPY_AS_MARKDOWN"]
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

  BG->>CS: COPY_OFFICE_FORMAT mode html
  CS->>S: getSelectionHtmlAndText()
  S-->>CS: html and text
  CS->>W: html_to_office_with_mathml
  W-->>CS: officeHtmlWithMathML
  CS->>X: convert math elements to OMML (msEquation conditional comments)
  X-->>CS: wrappedHtml
  CS->>C: writeHtml with html and text
  alt navigator.clipboard.write works
    C->>CLIP: write ClipboardItem with text/html and text/plain
  else fallback
    C->>BG: WRITE_CLIPBOARD message
    BG->>CLIP: Firefox MV2 direct clipboard
    BG->>CLIP: Chromium MV3 via offscreen document
  end
  CS-->>BG: response ok or error
```

## Test verification (deterministic)

- Tests never rely on any "native selection copy" behavior.
- Tests trigger copy via the same `tabs.sendMessage` path and verify the real OS clipboard using `tools/win_clipboard_dump.py`.

## Build Workflow

```mermaid
flowchart TB
  subgraph Source["Source Code"]
    RS["rust/tex_to_mathml_wasm/\n(Rust source)"]
    JS["extension/lib/\n(JavaScript modules)"]
    EXT["extension/\n(Extension files)"]
  end

  subgraph Build["Build Tools"]
    BRW["tools/build_rust_wasm.py"]
    BFX["tools/build_firefox_xpi.py"]
    BCH["tools/build_chromium_extension.py"]
    CJS["tools/check_js_size.py"]
  end

  subgraph Artifacts["Build Artifacts"]
    WASM["extension/wasm/tex_to_mathml.wasm"]
    XPI["dist/copy-as-office-format.xpi"]
    CHR["dist/chromium/\n(Chromium MV3 build)"]
  end

  subgraph Validation["Validation"]
    SIZE["JS Size Check\n(content-script.js <= 20KB)"]
  end

  RS -->|"cargo build"| BRW
  BRW --> WASM
  EXT --> BFX
  WASM --> BFX
  BFX --> XPI
  EXT --> BCH
  WASM --> BCH
  BCH --> CHR
  JS --> CJS
  CJS --> SIZE
```

## Build Pipeline Sequence

```mermaid
sequenceDiagram
  autonumber
  participant Dev as Developer
  participant BRW as build_rust_wasm.py
  participant Cargo as Cargo
  participant WASM as tex_to_mathml.wasm
  participant CJS as check_js_size.py
  participant BFX as build_firefox_xpi.py
  participant XPI as XPI Package

  Dev->>BRW: uv run python tools/build_rust_wasm.py
  BRW->>Cargo: cargo build --target wasm32-unknown-unknown
  Cargo-->>BRW: WASM binary
  BRW->>WASM: Copy to extension/wasm/
  Dev->>CJS: uv run python tools/check_js_size.py
  CJS-->>Dev: Size check (must be <= 20KB)
  Dev->>BFX: uv run python tools/build_firefox_xpi.py
  BFX->>XPI: Package extension/ into ZIP
  XPI-->>Dev: dist/copy-as-office-format.xpi
```

## Testing Workflow

```mermaid
flowchart TB
  subgraph Input["Test Inputs"]
    HTML["examples/*.html\n(Test fixtures)"]
  end

  subgraph Automation["Test Automation"]
    TA["tests/test_automated.py\n(Playwright)"]
    RCD["tests/test_real_clipboard_docx.py\n(Windows clipboard -> Word)"]
    RCM["tests/test_real_clipboard_markdown.py\n(Windows clipboard -> Markdown)"]
    WE["tests/test_word_examples.py\n(Word paste verification)"]
    GDX["tests/test_generate_docx_examples.py\n(Generate .docx artifacts)"]
  end

  subgraph Extension["Extension Under Test"]
    EXT["extension/\n(Firefox MV2)"]
    CHR["dist/chromium/\n(Chromium MV3)"]
  end

  subgraph Verification["Verification Tools"]
    WCD["tools/win_clipboard_dump.py\n(Clipboard inspection)"]
    VCF["tools/validate_cf_html.py\n(CF_HTML validation)"]
    WPP["tools/word_paste_probe.py\n(Word paste testing)"]
  end

  subgraph Output["Test Outputs"]
    ART["test_results/\n(Artifacts & reports)"]
    DOCX["test_results/docx/\n(Generated documents)"]
    CLIP["test_results/real_clipboard/\n(Clipboard dumps)"]
  end

  subgraph Cleanup["Cleanup"]
    CTR["tools/cleanup_test_results.py\n(Remove old artifacts)"]
  end

  HTML --> TA
  HTML --> RCD
  HTML --> RCM
  HTML --> WE
  HTML --> GDX
  EXT --> TA
  CHR --> TA
  TA --> WCD
  RCD --> WCD
  RCM --> WCD
  RCD --> WPP
  WE --> WPP
  WCD --> ART
  VCF --> ART
  WPP --> DOCX
  RCD --> CLIP
  RCM --> CLIP
  GDX --> DOCX
  ART --> CTR
  DOCX --> CTR
  CLIP --> CTR
```

## Testing Pipeline Sequence

```mermaid
sequenceDiagram
  autonumber
  participant Runner as Test Runner
  participant BRW as build_rust_wasm.py
  participant CJS as check_js_size.py
  participant TA as test_automated.py
  participant PW as Playwright
  participant EXT as Extension
  participant CLIP as OS Clipboard
  participant WCD as win_clipboard_dump.py
  participant CTR as cleanup_test_results.py

  Runner->>BRW: Build WASM
  BRW-->>Runner: WASM ready
  Runner->>CJS: Check JS size
  CJS-->>Runner: Size OK
  Runner->>TA: Run automated tests
  TA->>PW: Launch browser with extension
  PW->>EXT: Load extension
  TA->>EXT: tabs.sendMessage(COPY_OFFICE_FORMAT)
  EXT->>CLIP: Write clipboard
  TA->>WCD: Dump clipboard
  WCD-->>TA: Clipboard contents
  TA-->>Runner: Test results
  Runner->>CTR: Cleanup old artifacts
  CTR-->>Runner: Cleanup complete
```

