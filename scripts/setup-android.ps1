# One-time Android toolchain setup for building the APK on Windows.
# Installs a JDK and the Android command-line tools + SDK packages. Needs ~3 GB of disk and a download of ~1 GB.
# Review before running: it uses winget (JDK) and Google's official command-line tools zip.
param([string]$SdkPath = '')
$ErrorActionPreference = 'Stop'

if (-not (Get-Command java -ErrorAction SilentlyContinue)) {
  Write-Host 'Installing JDK 21 (Temurin) with winget...'
  winget install --id EclipseAdoptium.Temurin.21.JDK -e --accept-package-agreements --accept-source-agreements
  Write-Host 'Open a NEW terminal after this script so JAVA_HOME / PATH refresh, then run it again.'
}

# The SDK needs ~3 GB. Default to the drive with the most free space unless -SdkPath is given.
$sdk = $SdkPath
if (-not $sdk) {
  $best = Get-PSDrive -PSProvider FileSystem | Where-Object { $_.Free -gt 0 } | Sort-Object Free -Descending | Select-Object -First 1
  $sdk = if ($best.Name -eq 'C') { Join-Path $env:LOCALAPPDATA 'Android\Sdk' } else { "$($best.Name):\Android\Sdk" }
}
Write-Host "Android SDK location: $sdk"
New-Item -ItemType Directory -Force "$sdk\cmdline-tools" | Out-Null
if (-not (Test-Path "$sdk\cmdline-tools\latest\bin\sdkmanager.bat")) {
  # Check https://developer.android.com/studio#command-line-tools-only for the current zip name.
  $zipUrl = 'https://dl.google.com/android/repository/commandlinetools-win-11076708_latest.zip'
  $zip = Join-Path $env:TEMP 'cmdline-tools.zip'
  Invoke-WebRequest $zipUrl -OutFile $zip
  Expand-Archive $zip -DestinationPath "$sdk\cmdline-tools\tmp" -Force
  Move-Item "$sdk\cmdline-tools\tmp\cmdline-tools" "$sdk\cmdline-tools\latest" -Force
  Remove-Item "$sdk\cmdline-tools\tmp" -Recurse -Force
}

[Environment]::SetEnvironmentVariable('ANDROID_HOME', $sdk, 'User')
$env:ANDROID_HOME = $sdk
$sm = "$sdk\cmdline-tools\latest\bin\sdkmanager.bat"
'y' * 20 | & $sm --licenses | Out-Null
& $sm 'platform-tools' 'platforms;android-36' 'build-tools;36.0.0'
Write-Host "Done. ANDROID_HOME=$sdk. Open a new terminal, then: npm run apk"
