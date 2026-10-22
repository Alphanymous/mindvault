# Known gaps and verification status

## Verified on this machine (Windows 11, Node 24)

- `npm test`: 48 unit tests pass (wikilink/frontmatter/tag parsing, classifier, link index + graph building, HTML→Markdown readability, search ranking, prompt variables, Drive sync planner, LLM refinement with a fake fetch).
- `npm run build`: type-check clean, production build and PWA service worker generated.
- Web app run in the browser preview and exercised: sample vault, force graph (select/highlight, filter UI, options), inbox cards with Accept / Accept all, library and folder tree, item view with wikilinks, backlinks and local graph, prompt variables, Ctrl+K search, mobile layout (375 px) with tab bar.
- Capture pipeline run in the browser: pasted prompt, pasted note, link (CORS fallback saves link only with a warning), web clip with a stubbed fetch (readability + classification), and a real generated PDF (pdf.js worker extracted text, original stored, classified as Business/Finance).
- `npx cap add android` generated the native Android project.
- **Windows build**: `Mindvault Setup 0.1.0.exe` (NSIS, 120 MB) and `Mindvault-0.1.0-win.zip` (166 MB) were produced. The packaged `Mindvault.exe` was launched and driven over the debugging port: it serves the UI (Inbox screen rendered), the preload bridge reports `electron`, the CORS-free page fetch returns real HTML from example.com, and loopback/LAN addresses are refused. The installer itself was **not run** (installing would change this machine); only its build succeeded.

## Not verified / not done

- Windows artifacts were built into `D:\mindvault-build\release` because C: had under 1 GB free (see README, Windows app).
- **Android APK not built.** This machine has no JDK and no Android SDK (Capacitor 8 needs JDK 21+, platform 36). Run `scripts/setup-android.ps1`, open a new terminal, then `npm run apk`. Nothing about the APK runtime (WebView behaviour, native fetch for clipping, sideload install) has been tested.
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
