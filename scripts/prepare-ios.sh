#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
desktop_dir="$project_root/desktop"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "ORBIT iOS setup must run on macOS with Xcode installed." >&2
  exit 1
fi

command -v xcodebuild >/dev/null 2>&1 || {
  echo "xcodebuild was not found. Install Xcode from the Mac App Store first." >&2
  exit 1
}

if ! xcode-select -p >/dev/null 2>&1; then
  echo "Xcode command-line tools are not selected. Run: sudo xcode-select --switch /Applications/Xcode.app/Contents/Developer" >&2
  exit 1
fi

export ORBIT_SURFACE="personal"
cd "$desktop_dir"

if [[ ! -d "src-tauri/gen/apple" ]]; then
  npx @tauri-apps/cli@2.11.4 ios init
else
  echo "Tauri iOS project already exists at src-tauri/gen/apple"
fi

npx @tauri-apps/cli@2.11.4 info

echo
echo "Next: open desktop/src-tauri/gen/apple in Xcode, select a development team, and run the ORBIT target on an iPhone simulator or device."
