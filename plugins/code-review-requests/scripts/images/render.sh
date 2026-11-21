#!/bin/bash
# Renders the catalog images (images/*.png) from mock.html with headless Chrome.
# The data in mock.html is made up; keep it that way. Needs Google Chrome and Orca (for the Geist font).
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
out="$here/../../images"
chrome="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
font="$(ls /Applications/Orca.app/Contents/Resources/app.asar.unpacked/out/renderer/assets/Geist-Variable-*.woff2 | head -1)"
work="$(mktemp -d)"; trap 'rm -rf "$work"' EXIT
cp "$here/mock.html" "$work/"; cp "$font" "$work/Geist.woff2"
shot() { # frame, css size, output name
  "$chrome" --headless=new --disable-gpu --hide-scrollbars --default-background-color=00000000 \
    --force-device-scale-factor=2 --window-size="$2" --virtual-time-budget=2000 \
    --screenshot="$out/$3.png" "file://$work/mock.html#$1" >/dev/null 2>&1
}
shot icon 256,256 icon
shot cover 800,500 cover
shot todo 1280,800 review-requests
shot statusbar 1280,800 status-bar
shot workspace 1280,800 review-workspace
shot draft 1280,800 review-draft
ls -l "$out"
