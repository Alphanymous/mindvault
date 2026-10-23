# Phone pairing, share sheet and browser clipper

## 1. Pair your phone with the Windows app (same Wi-Fi, no Google)

1. On the computer: Mindvault → **Settings → Pair your phone** → switch on *Allow phone pairing on this network*.
   A QR code and a link such as `http://192.168.1.5:47822/#/pair/<code>` appear. The first time, Windows asks whether to allow Mindvault through the firewall: choose **Private networks**.
2. On the phone, either:
   - **Phone browser (nothing to install):** scan the QR code with the camera or open the link. The page loads from the computer, pairs itself and syncs. (Plain http means it cannot be "installed" as an app, and it keeps its own copy of your notes in the phone browser.)
   - **Android app:** Settings → *Sync with your computer* → **Scan QR code** (or paste the link) → Pair.
3. After pairing, the phone syncs about every minute while the app is open, and when you open it. Notes, prompts, links and PDF originals travel both ways. Newest edit wins per item; deletions sync.

Security: the code is a random 128-bit secret; every request must carry it. Traffic on home Wi-Fi is **not encrypted**, so use it on networks you trust. *Reset pairing code* in Settings disconnects every phone. Turning the switch off closes the port.

## 2. Share sheet (Android app)

Install the APK, then in Chrome, a file manager, WhatsApp, anywhere: **Share → Mindvault**. Links become web clips (title and readable text are fetched), text becomes a note or prompt, PDFs and text files are imported with their text extracted. Everything is filed automatically and shows under New. Files over 40 MB are skipped.

The installed PWA gets the same share target on Android Chrome when the site is hosted over https.

## 3. Browser clipper (desktop)

Settings → **Browser clipper** → drag *Save to Mindvault* to your bookmarks bar (or copy it and paste as the URL of a new bookmark).
Click it on any page to send the rendered page, so pages behind a login and JavaScript-built pages work. Select text first to save only the selection. Mindvault must be running.

Limits: sites with a strict Content-Security-Policy (for example github.com) block bookmarklets; Chrome may ask to allow access to local network devices the first time.
