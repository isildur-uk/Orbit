# ORBIT Personal Network mobile release

The mobile product has two layers:

1. The shared Personal Network surface, which already runs responsively in a
   browser and can be installed to a phone home screen as a PWA.
2. A signed Tauri Android/iOS wrapper, which packages the same surface as a
   store-distributable app after the vault sync and mobile permissions are
   ready.

## Test it on a phone now

From this project folder, run `scripts/serve-orbit-phone.ps1`, then open the
printed Wi-Fi URL on the phone. The phone and computer must be on the same
network. The preview server serves both the Personal Network surface and its
shared runtime files, and injects live reload; keep the page open while editing
and it will refresh itself when source files change. For a shareable
installation, serve `src/personal-network/` over
HTTPS, or serve the generated standalone payload from `standalone/dist/`. Open the URL on the phone and use the browser's
“Add to Home Screen” / “Install app” action. The manifest provides the app name,
icon and standalone display mode; the service worker caches the surface after
the first visit.

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\serve-orbit-phone.ps1
```

This local preview is for testing the interface and local data model. It is not
an internet-accessible deployment and it should not be used for sensitive data.

The installed web surface is useful for validating the mobile interaction
model now: Network, Profile and Capture are thumb-reachable, and selecting a
person opens the profile as the mobile detail screen.

## Native store builds

The native route uses this project's `desktop/src-tauri/` crate and the same
embedded Personal Network payload. The Android target is now initialized at
`desktop/src-tauri/gen/android/` and a debug ARM64 APK has been built
successfully. The iOS target is prepared by `scripts/prepare-ios.sh` on a Mac.

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\prepare-android.ps1
$env:JAVA_HOME='C:\Program Files\Android\Android Studio\jbr'
$env:ANDROID_HOME="$env:LOCALAPPDATA\Android\Sdk"
$env:ANDROID_SDK_ROOT=$env:ANDROID_HOME
$env:NDK_HOME="$env:ANDROID_HOME\ndk\27.2.12479018"
$env:ORBIT_SURFACE='personal'
npx @tauri-apps/cli@2.11.4 android build --debug --apk --target aarch64 --ci
```

Android can be prepared on Windows once the Android Studio SDK, platform tools,
command-line tools, NDK, Java and Rust Android targets are installed. The
`prepare-android.ps1` script finds the Android Studio JBR/SDK, checks for the
NDK, sets the required environment variables and runs the pinned Tauri CLI.
iOS builds require macOS, Xcode and Apple signing. Run this from the project
root on the Mac:

```bash
bash ./scripts/prepare-ios.sh
```

The script initializes `desktop/src-tauri/gen/apple/` and prints the environment
details needed to open the generated project in Xcode. In Xcode, select the
Apple Developer team for the existing identifier
`uk.co.isildur.orbit.personal`, then run the app on a simulator or connected
iPhone. For TestFlight/App Store distribution, use Xcode's Archive and
Distribute App workflow after signing is configured.

The current local Android toolchain includes command-line tools, NDK
`27.2.12479018`, CMake `3.22.1`, Android Build Tools `35.0.0`, Android Platform
36 and all four Rust Android targets. The generated debug APK is:

`desktop/src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk`

Before native packaging, the Personal Network surface needs:

- a vault/sync backend with offline writes and conflict handling;
- explicit user-controlled imports and permissions for contacts, calendar and
  any approved social sources;
- app privacy/data-safety declarations that match the final sync and analytics
  behaviour;
- production app identifiers, icons, signing certificates and store metadata.

For production release, add the final app identifier, icons, signing
credentials, privacy/data-safety declarations and store metadata. iOS still
requires a Mac/Xcode signing environment.
