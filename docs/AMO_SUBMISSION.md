# AMO submission checklist

## 1) Extension ID
Set a stable extension ID in `extension/manifest.json`:
- `applications.gecko.id` should be a unique value you control (recommended: an email-like or domain-based ID).

## 2) Build a clean package (manifest at archive root)
```powershell
uv run python tools/build_rust_wasm.py
uv run python tools/build_firefox_xpi.py --out dist/copy-as-office-format.xpi
```

Upload the produced `.xpi` (it is just a `.zip`) to AMO.

## 3) Permissions justification
Be ready to explain:
- `contextMenus` (context menu entry)
- `activeTab` (read selection/DOM on user action)
- `clipboardWrite` (write the converted selection)

## 4) Privacy policy
Provide a public privacy policy URL. Use `docs/PRIVACY.md` as a starting draft.

## 5) Basic manual verification (before upload)
- Load temporary add-on from `extension/manifest.json`.
- Copy from:
  - `examples/gemini-conversation-test.html`
  - `examples/selection_example_static.html`
  - `examples/ChatGPT_example.html`
- Paste into Word and confirm equations are editable.

## 6) Keep requirements current
AMO policies (including Manifest V2 vs V3) can change; check current AMO requirements before submission.
