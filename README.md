# Mindvault

A local-first personal knowledge base in the spirit of Obsidian, but simpler and nicer to look at.
Save notes, PDFs, web pages, reusable AI prompts and files. Everything is **auto-sorted into an inbox** you accept in one click, linked into a **living knowledge graph**, searchable from anywhere, and optionally **synced through your own Google Drive**.

One TypeScript/React codebase, three targets:

| Target | How | Output |
| --- | --- | --- |
| Website / installable PWA | Vite + `vite-plugin-pwa` | `dist/` |
| Windows app | Electron + electron-builder | `release/Mindvault Setup *.exe`, `release/Mindvault *.exe` (portable) |
| Android app | Capacitor | `release/Mindvault-debug.apk` (needs JDK + Android SDK, see below) |

Only [Obsidian](https://obsidian.md/) was used as a feature reference. All code here is original.

## What it does

- **Home dashboard**: continue where you left off, a prompt shelf with one-tap copy, pinned items, recent captures and **smart collections** (saved filters such as "Unread web clips" or "This week" that update themselves; save your own from any filter in the Library).
- **Search that understands you**: `Ctrl K` fuses exact words, word forms and topics ("money" finds your invoices), highlights the matching passage, and can add true meaning-based matching through your own embeddings endpoint. Every note shows a **Related** panel with one-click suggested `[[links]]`.
- **Prompt toolbox**: favorites, categories, variants, "recently used", copy-for-a-model with usage counts, remembered `{{variable}}` answers (so a prompt copies filled-in from the shelf), optional "Run it now" against your own chat endpoint, and Share on mobile.
- **PDF and web reader with highlights**: open the original PDF in the app, select text, pick a color. Highlights sync with the document and each one can become a note that links back to the exact page.
- **Keyboard-first**: `>` commands, `#` tags and `@` folders/collections inside search, vim-style `g i` / `g l` / `c` / `n` / `p` shortcuts (`?` lists them), and **voice capture** (Dictate in Capture, or hold the + button on a phone).
- **Android extras**: home-screen widget (Capture, Voice, Search, Prompts), long-press launcher shortcuts and the share sheet.

- **Capture** (`Ctrl+N`, the + button, paste anywhere, drag files in, or the PWA share target): a link becomes a clipped web page (readable text + original link), a PDF has its text extracted and the original kept, Markdown/text files become notes, anything else is stored as a file, pasted text that reads like an AI prompt becomes a prompt.
- **Inbox → Library**: every capture gets a type, a suggested folder and tags with a confidence bar. **Accept** files it, **Change** lets you adjust folder/tags/type, **Accept all** clears the lot. Suggestions learn from folders and tags you already use.
- **Prompts**: one-click copy, with `{{variables}}` filled from small input fields first.
- **Notes**: Markdown with `[[wikilinks]]` (autocomplete after `[[`), `[[Note|alias]]`, `#tags`, backlinks panel, renaming a note updates links pointing at it, links to missing notes can be created in one click.
- **Graph**: canvas force graph. Zoom (wheel/pinch/buttons), pan, drag nodes, hover to highlight neighbours, click to select, double-click to open, filter by text, toggle tags/folders/unwritten links/orphans, filter by item type. Every note also shows a local graph.
- **Search**: `Ctrl+K` palette over titles, tags, folders and full text, plus actions.
- **Phone ↔ computer pairing** over Wi-Fi with a QR code, no Google account needed; see [docs/PHONE_AND_CLIPPER.md](docs/PHONE_AND_CLIPPER.md).
- **Share sheet** on Android ("Share → Mindvault" for links, text, PDFs) and a **browser clipper** bookmarklet for the desktop app.
- **Settings that explain themselves**: tabs for General, Sync, Capture, AI, Data and About. Guided Google sign-in with direct links and a client-ID check, one AI connection (OpenAI, OpenRouter, Ollama, LM Studio or custom) that powers sorting, meaning search and prompt runs, a clear page-download setup, and a **Test** button on every connection that tells you in plain words what works.
- **Black and gold** theme with matching icons on web, Windows and Android (dark and light).
- **Offline first**: data lives in IndexedDB on the device; the PWA works without a network.
- **Google Drive sync** (optional, bring your own OAuth client ID): see [docs/GOOGLE_DRIVE_SETUP.md](docs/GOOGLE_DRIVE_SETUP.md).
- **Optional AI sorting**: point Settings at any OpenAI-compatible chat endpoint to refine folders and tags (rules always work offline).

## Quick start

```bash
npm install
npm run dev          # http://localhost:5173
npm test             # unit tests (parsing, classification, link graph, readability, search, sync plan)
npm run build        # type-check + production web build + PWA service worker
```

Open **Settings → Add sample notes** to see a connected demo vault and graph.

### Website / PWA

`npm run build` produces a static site in `dist/` (relative base, so it works from any sub-path). Host it anywhere over HTTPS (GitHub Pages, Netlify, Cloudflare Pages, your own server) and use the browser's *Install* button. Add the site origin to your Google OAuth client if you want Drive sync.

### Windows app

```bash
npm run dist:win
```

Produces `release/Mindvault Setup 0.1.0.exe` (NSIS installer) and `release/Mindvault-0.1.0-win.zip` (unzip and run `Mindvault.exe`, no install). Needs roughly 1.5 GB of free disk during packaging; if the system drive is tight, build elsewhere:

```powershell
$env:TEMP='D:\tmp'; $env:TMP='D:\tmp'; npx electron-builder --win --publish never --config.directories.output=D:/mindvault-build/release
```

(On a nearly full C: drive the NSIS step fails with `error creating mmap`, and 7-Zip fails with exit code 2.) Do not run `npm run dev` while packaging: on Windows the Vite file watcher can lock `release/` (the config now ignores it).

The app serves its bundled UI from `http://localhost:47821` (falls back to a random port if busy) so Google Sign-In has a legal origin; register `http://localhost:47821` in your OAuth client. Web clipping works without CORS limits because pages are fetched by the Electron main process (private/LAN addresses are refused). The build is **unsigned**, so SmartScreen shows a warning on first run.

### Android APK

This machine needs a JDK 21+ and the Android SDK. Check with `java -version` and `echo %ANDROID_HOME%`. If missing, review and run once:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/setup-android.ps1   # JDK 21 via winget + Android cmdline tools + platform 36 (about 1 GB download)
# open a NEW terminal so JAVA_HOME / ANDROID_HOME apply, then:
npm run apk
```

Tip: if C: is short on space, put the JDK, SDK and Gradle cache on another drive and set `JAVA_HOME`, `ANDROID_HOME` and `GRADLE_USER_HOME` before building (that is how the first APK was built). `npm run apk` runs [scripts/build-apk.ps1](scripts/build-apk.ps1): web build, `cap add android` (first time), `cap sync`, `gradlew assembleDebug`, and copies the result to `release/Mindvault-debug.apk`. Enable "install unknown apps" on the phone and open the file. A debug APK is signed with the debug key; for the Play Store make a release keystore and run `gradlew bundleRelease`.
The Capacitor config turns on `CapacitorHttp`, so web clipping on Android bypasses CORS.

## Project layout

```
src/core      pure logic, unit tested: markdown/wikilinks/tags, classify, links+graph, search, readable (HTML→Markdown), prompts
src/data      IndexedDB (idb), reactive store, sample vault
src/import    PDF text extraction (pdf.js), web clipping, capture routing
src/sync      Google token flow, Drive appDataFolder sync, last-writer-wins planner
src/ui        React screens: Inbox, Library, Item, Graph (canvas), Palette, Capture, Settings
electron/     main + preload (local static server, CORS-free fetch)
scripts/      icon generation, Android setup + APK build
docs/         Google Drive setup guide
```

## Design choices

- **Vite + React + TypeScript**: one build feeds the PWA, Electron and Capacitor unchanged.
- **Canvas graph with d3-force physics and custom rendering** instead of a graph library, for smooth hover/glow/label control and low overhead on phones.
- **Rule-based classifier with a clean LLM hook**: deterministic, offline, explainable ("mentions typescript, compiler"), and it learns from your own folders.
- **Drive `appDataFolder` + `drive.appdata` scope**: non-sensitive scope (no Google review), hidden from the Drive UI, one small JSON file per item.
- **Last-writer-wins sync** per item: simple and predictable for one person on a few devices.

See [KNOWN_GAPS.md](KNOWN_GAPS.md) for what is not done or not verified.

## License

MIT, see [LICENSE](LICENSE).
