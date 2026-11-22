#!/bin/bash
# Renders the catalog icon and screenshots (images/*.png; the cover, images/cover.jpg, is made by hand) from mock.html with headless Chrome.
# The data in mock.html is made up; keep it that way. Needs Google Chrome, Orca (for the Geist font) and network (Google Fonts).
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
out="$here/../../images"
chrome="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
font="$(ls /Applications/Orca.app/Contents/Resources/app.asar.unpacked/out/renderer/assets/Geist-Variable-*.woff2 | head -1)"
work="$(mktemp -d)"; trap 'rm -rf "$work"' EXIT
cp "$here/mock.html" "$work/"; cp "$font" "$work/Geist.woff2"
shot() { # frame, css size, output name
  "$chrome" --headless=new --disable-gpu --hide-scrollbars --default-background-color=00000000 \
    --force-device-scale-factor=2 --window-size="$2" --virtual-time-budget=4000 \
    --screenshot="$out/$3.png" "file://$work/mock.html#$1" >/dev/null 2>&1
}
shot icon 256,256 icon
shot todo 1280,800 review-requests
shot statusbar 1280,800 status-bar
shot workspace 1280,800 start-review
shot draft 1280,800 finish-review
# review-workspace.png and review-draft.png stay as released up to 0.6.6: the catalog pins each
# release's images by path and sha256, so a changed screenshot gets a new name.
shot cards 414,600 review-cards # four cards on transparent, the cards on the cover; kept next to the mock, trimmed below
mv "$out/review-cards.png" "$here/review-cards.png"
python3 -c 'import sys; from PIL import Image; p=sys.argv[1]; i=Image.open(p); i.crop(i.getbbox()).save(p, optimize=True)' "$here/review-cards.png"
ls -l "$out"
