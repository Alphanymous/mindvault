# Builds a debug APK (installable by sideloading) from the web build.
# Requires: Node, JDK 21+ (JAVA_HOME), Android SDK with platform 36 + build-tools (ANDROID_HOME).
# Run scripts\setup-android.ps1 first if you do not have the JDK / SDK yet.
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)

function Need($ok, $msg) { if (-not $ok) { Write-Error $msg; exit 1 } }

$javaOk = [bool](Get-Command java -ErrorAction SilentlyContinue) -or ($env:JAVA_HOME -and (Test-Path "$env:JAVA_HOME\bin\java.exe"))
Need $javaOk 'JDK not found. Install JDK 21+ (see README "Android APK") and set JAVA_HOME.'
$sdk = $env:ANDROID_HOME; if (-not $sdk) { $sdk = $env:ANDROID_SDK_ROOT }
Need ($sdk -and (Test-Path $sdk)) 'Android SDK not found. Set ANDROID_HOME (see README "Android APK").'

# Gradle caches ~2 GB under the user profile; move it when the system drive is short on space.
if (-not $env:GRADLE_USER_HOME -and (Get-PSDrive C).Free -lt 6GB) {
  $best = Get-PSDrive -PSProvider FileSystem | Sort-Object Free -Descending | Select-Object -First 1
  if ($best.Name -ne 'C') { $env:GRADLE_USER_HOME = "$($best.Name):\gradle-home"; Write-Host "Using GRADLE_USER_HOME=$env:GRADLE_USER_HOME" }
}

npm run build
if (-not (Test-Path android)) { npx cap add android }
npx cap sync android

# Point Gradle at the SDK (local.properties is git-ignored)
"sdk.dir=$($sdk -replace '\\','/')" | Set-Content android\local.properties -Encoding ascii

Push-Location android
.\gradlew.bat assembleDebug
Pop-Location

$apk = 'android\app\build\outputs\apk\debug\app-debug.apk'
Need (Test-Path $apk) 'Gradle finished but no APK was produced.'
New-Item -ItemType Directory -Force release | Out-Null
Copy-Item $apk release\Mindvault-debug.apk -Force
Write-Host "APK ready: release\Mindvault-debug.apk"
