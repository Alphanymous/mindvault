# Build the Mindvault APK with Android Studio

Note: Google AI Studio cannot build Android APKs. Use **Android Studio** (free, from developer.android.com/studio). It bundles the JDK and downloads the Android SDK for you.

## Steps
1. Install Android Studio (latest stable). Start it once and let it finish the first-run SDK setup.
2. **File > Open** and pick the `android` folder inside this project (not the project root).
   The folder `node_modules/@capacitor/android` must stay next to it (it is included in the zip).
3. Wait for "Gradle sync" to finish. If asked, click to install Android SDK Platform 36 and accept the licences (SDK Manager > SDK Platforms).
   If it complains about the Java version: File > Settings > Build Tools > Gradle > Gradle JDK > choose "jbr-21" (the one bundled with Android Studio).
4. **Build > Build Bundle(s) / APK(s) > Build APK(s)**. When it finishes, click "locate" in the popup.
   The file is `android/app/build/outputs/apk/debug/app-debug.apk`.
5. Send `app-debug.apk` to your phone (USB, Drive, email, chat). On the phone open it and allow "Install unknown apps" for the app you opened it from.
   Or, with USB debugging on, press the green Run button in Android Studio with the phone selected.

## Command line instead (needs JDK 21 + Android SDK 36)
    cd android
    gradlew.bat assembleDebug

## Changing the app
The web code is in `src/`. After edits run `npm install`, `npm run build`, `npx cap sync android`, then rebuild in Android Studio.

## Notes
- The APK is a debug build signed with the debug key: fine for your own phone, not for the Play Store.
- Google Drive sync from the APK is untested; see KNOWN_GAPS.md and docs/GOOGLE_DRIVE_SETUP.md.
