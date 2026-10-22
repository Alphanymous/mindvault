# Google Drive sync: create your OAuth client ID

Mindvault syncs through your own Google Cloud project, so no one else ever sees your data or shares a quota with you. It is free and takes about five minutes. You do this once.

The app only requests the **`drive.appdata`** scope. Your vault is stored in a hidden app-data folder that does not show in the Drive file list and cannot be read by any other app. Because this is a non-sensitive scope, Google does not require app verification for personal use.

## 1. Create a project

1. Open <https://console.cloud.google.com/> and sign in.
2. Project picker (top bar) → **New project** → name it `Mindvault` → **Create**.

## 2. Enable the Drive API

1. **APIs & Services → Library**.
2. Search **Google Drive API** → **Enable**.

## 3. Configure the consent screen

1. **APIs & Services → OAuth consent screen** (newer console: **Google Auth platform → Branding / Audience**).
2. User type **External** → **Create**.
3. App name `Mindvault`, your email for support and developer contact → save.
4. **Data access / Scopes** → add `https://www.googleapis.com/auth/drive.appdata`.
5. **Audience / Test users** → add your own Google address. While the app is in *Testing* status only listed test users can sign in, which is fine for personal use. (Tokens for apps in Testing expire after 7 days, so you will be asked to sign in again about weekly. Click **Publish app** to remove that limit; for a non-sensitive scope no review is required.)

## 4. Create the OAuth client ID

1. **APIs & Services → Credentials → Create credentials → OAuth client ID**.
2. Application type: **Web application**. Name: `Mindvault web`.
3. **Authorized JavaScript origins**: add every origin you will open the app from:
   - Windows desktop app: `http://localhost:47821`
   - Local dev server: `http://localhost:5173`
   - Your deployed website, e.g. `https://notes.example.com`
   - Android app: `https://localhost` (see the Android note in the README)
4. Leave *Authorized redirect URIs* empty (the sign-in uses a popup, not redirects).
5. **Create**. Copy the **Client ID** (looks like `123456789-abc.apps.googleusercontent.com`). You do **not** need the client secret.

## 5. Put the client ID in the app

Either way works:

- **In the app (recommended):** Settings → *Google OAuth client ID* → paste → **Sign in & sync**.
- **At build time:** create `.env.local` in the project root with `VITE_GOOGLE_CLIENT_ID=your-id.apps.googleusercontent.com` and rebuild. The in-app value, if set, wins.

Repeat the paste on each device (the ID is stored per device, never uploaded).

## How sync behaves

- Each note is one small JSON file in the app-data folder (`item-<id>.json`), originals (PDFs, files) are `blob-<id>`.
- Last writer wins per item, using the item's last-edit time. Deleting leaves a tiny tombstone so deletes propagate.
- Auto-sync runs every 5 minutes and when the device comes back online, but only after you have signed in once on that device in this browser session/app.
- To reset: Settings → *Sign out*, and (if you want to wipe the cloud copy) delete Mindvault under <https://drive.google.com/drive/u/0/settings> → *Manage apps*.

## Troubleshooting

| Message | Cause / fix |
| --- | --- |
| `Error 400: origin_mismatch` | The page origin is not in *Authorized JavaScript origins* (step 4). Compare it to the origin shown in Settings. |
| `Error 403: access_denied` | Your account is not a test user (step 3.5), or the app is unpublished and you used another account. |
| `Access blocked: has not completed the Google verification process` | Add your account as a test user, or publish the app. |
| Popup blocked | Allow popups for the site/app, then click *Sign in & sync* again. |
| `Google Drive error 403 ... accessNotConfigured` | Drive API not enabled for the project (step 2). |
