# Known gaps and verification status

## Verified on this machine (Windows 11, Node 24)

- `npm test`: 48 unit tests pass (wikilink/frontmatter/tag parsing, classifier, link index + graph building, HTML→Markdown readability, search ranking, prompt variables, Drive sync planner, LLM refinement with a fake fetch).
- `npm run build`: type-check clean, production build and PWA service worker generated.
- Web app run in the browser preview and exercised: sample vault, force graph (select/highlight, filter UI, options), inbox cards with Accept / Accept all, library and folder tree, item view with wikilinks, backlinks and local graph, prompt variables, Ctrl+K search, mobile layout (375 px) with tab bar.
- Capture pipeline run in the browser: pasted prompt, pasted note, link (CORS fallback saves link only with a warning), web clip with a stubbed fetch (readability + classification), and a real generated PDF (pdf.js worker extracted text, original stored, classified as Business/Finance).
- `npx cap add android` generated the native Android project.
- **Windows build**: `Mindvault Setup 0.1.0.exe` (NSIS, 120 MB) and `Mindvault-0.1.0-win.zip` (166 MB) were produced. The packaged `Mindvault.exe` was launched and driven over the debugging port: it serves the UI (Inbox screen rendered), the preload bridge reports `electron`, the CORS-free page fetch returns real HTML from example.com, and loopback/LAN addresses are refused. The installer itself was **not run** (installing would change this machine); only its build succeeded.
- **Phone pairing, end to end, on the packaged Windows app:** pairing switched on, QR and link shown, LAN server answered with the token only (401 without), a browser opened the pairing link over plain http, paired itself, pulled 12 items including a 6.5 MB PDF original, pushed a new note back, and bad items were rejected. The browser clipper endpoint accepted a full page and a text selection and refused a wrong token. Test items were removed afterwards and pairing was switched off. Run from a desktop browser on the same machine, not from a real phone.
- `npm test`: 81 tests pass (adds pairing, sync protocol, share parsing, desktop server). On this slow machine vitest sometimes reports one worker start-up timeout; the tests themselves pass.

- **v0.2 features, verified in the browser preview**: dashboard, collections (built-in and saved), prompt toolbox (remembered variables, model usage counts, quick copy), prompts page, PDF reader with page highlights saved with the item, web-text highlights that survive re-opening, highlight-to-note with page link, related panel, palette modes (`>`, `#`, `@`), topical search with passage highlights, keyboard shortcuts.
- Settings redesign verified in the browser preview: tabs, client-ID validation (rejects a client secret, accepts a real-looking ID), saving enables sign-in, AI presets fill both endpoints and hide the key for local services, test buttons show friendly failures and time out instead of hanging. The desktop app now removes the PWA service worker so upgrades never show old files.
- Unit tests: 126 pass (adds collections, usage, keys, stemming/similarity, search fusion, embeddings with a fake endpoint, highlight anchoring in jsdom).

## Not verified / not done

- **Google sign-in itself was not exercised**: it needs your own client ID. The checks around it (format validation, guided steps, error messages, Drive API test call) are tested with fakes.

- **v0.2 not run on a real phone or in the packaged apps**: the widget, launcher shortcuts and hold-to-speak compile and are wired, but only the web UI was exercised. Dictation needs a browser with the speech API; it is hidden in the Windows app.
- **Meaning search was tested only with a fake embeddings endpoint**. The built-in topical search is not true semantic understanding: it knows word forms and the topic dictionary, nothing more.
- PDF highlights store text rectangles per page: they stay aligned across window sizes, but highlighting across two pages at once is not supported, and scanned PDFs have no selectable text.

- **Android APK built and inspected, not run on a device.** `gradlew assembleDebug` succeeds (JDK 21, platform 36), so the share-sheet plugin compiles, and the APK manifest contains the share intent filters, camera permission and cleartext traffic. Nothing has been run on a phone or emulator: share-sheet delivery, QR scanning with `BarcodeDetector` in the WebView, native fetch for clipping, LAN pairing and Drive sign-in are all untested. Pasting the pairing link works without the camera.
- LAN pairing is plain http on your Wi-Fi (token-protected, not encrypted). The hosted https PWA cannot call it (browser mixed-content rule); use the phone browser pairing link or the APK.
- The browser clipper is a bookmarklet, not an extension: strict-CSP sites block it, and it only targets the desktop app.

- Windows artifacts were built into `D:\mindvault-build\release` because C: had under 1 GB free (see README, Windows app).
- **Google Drive sync is untested against real Google.** It needs your OAuth client ID. The planner is unit tested and the REST calls follow the Drive v3 docs, but no real sign-in or upload was run. Expect to fix small details on first real use.
- **Drive sign-in inside Electron and Android WebView** relies on the Google Identity Services popup. It should work in Electron (origin `http://localhost:47821`) but is unverified; in the Android WebView popups are unreliable and may need a native sign-in plugin (for example Capacitor social login with an Android client ID).
- Web clipping from a plain browser is limited by CORS (by design: use the desktop/Android app, or set a proxy in Settings). Pages that need JavaScript to render are not captured.
- PDFs without a text layer (scans) are stored but have no extracted text; no OCR.
- Classification is keyword/rule based: broad topic dictionary in English, weak on other languages, and link-only clips classify from the URL text. The optional LLM refinement is implemented and tested with a fake endpoint only.
- Sync is last-writer-wins per item: simultaneous edits of the same note on two devices keep only the newer one. Blobs (PDFs) are uploaded once and never updated.
- No conflict UI, no version history, no encryption at rest or in Drive (appDataFolder is private to the app, not end-to-end encrypted).
- No image attachments inside notes, no canvas/whiteboard, no plugin system, no folder rename/move UI beyond editing the folder field per item.
- The Windows build is unsigned (SmartScreen warning) and not auto-updating.
- No automated UI/e2e tests; UI was checked manually in the browser preview.
