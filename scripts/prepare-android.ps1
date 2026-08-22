param(
  [string]$AndroidHome = $(if ($env:ANDROID_HOME) { $env:ANDROID_HOME } else { Join-Path $env:LOCALAPPDATA "Android\Sdk" }),
  [string]$JavaHome = $(if ($env:JAVA_HOME) { $env:JAVA_HOME } else { "C:\Program Files\Android\Android Studio\jbr" })
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$ndkRoot = Join-Path $AndroidHome "ndk"
$ndk = Get-ChildItem -LiteralPath $ndkRoot -Directory -ErrorAction SilentlyContinue | Sort-Object Name -Descending | Select-Object -First 1

if (-not (Test-Path (Join-Path $JavaHome "bin\java.exe"))) {
  throw "Java was not found at '$JavaHome'. Install Android Studio's bundled JBR or set -JavaHome."
}
if (-not (Test-Path $AndroidHome)) {
  throw "Android SDK was not found at '$AndroidHome'. Install it in Android Studio or set -AndroidHome."
}
if (-not $ndk) {
  throw "Android NDK was not found under '$ndkRoot'. In Android Studio open SDK Manager > SDK Tools, install NDK (Side by side) and CMake, then rerun this script."
}

$env:JAVA_HOME = (Resolve-Path $JavaHome).Path
$env:ANDROID_HOME = (Resolve-Path $AndroidHome).Path
$env:ANDROID_SDK_ROOT = $env:ANDROID_HOME
$env:NDK_HOME = $ndk.FullName
$env:ORBIT_SURFACE = "personal"

Push-Location (Join-Path $projectRoot "desktop")
try {
  npx @tauri-apps/cli@2.11.4 android init --ci
  if ($LASTEXITCODE -ne 0) { throw "Tauri Android initialization failed with exit code $LASTEXITCODE." }
} finally {
  Pop-Location
}
