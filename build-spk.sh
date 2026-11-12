#!/bin/sh
# Builds dist/DeBarrier-<version>-x86_64.spk.
# Usage: ./build-spk.sh [outdir]
set -eu
HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="${1:-$HERE/dist}"
VERSION="$(tr -d ' \r\n' < "$HERE/VERSION")"
BUILD="${BUILD_NUMBER:-0001}"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# The service: one static Linux binary.
mkdir -p "$WORK/pkg/bin" "$WORK/pkg/ui" "$WORK/pkg/compose"
(cd "$HERE" && CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath \
	-ldflags "-s -w -X main.version=$VERSION" -o "$WORK/pkg/bin/debarrier" .)
chmod 755 "$WORK/pkg/bin/debarrier"

# The DSM window, and the engines' compose project.
cp -R "$HERE/ui/." "$WORK/pkg/ui/"
for f in index.html DeBarrier.js; do sed -i "s/@VERSION@/$VERSION/g" "$WORK/pkg/ui/$f"; done
chmod 755 "$WORK/pkg/ui/api.cgi"
cp "$HERE/compose/compose.yaml" "$HERE/compose/compose.yml" "$WORK/pkg/compose/"
(cd "$WORK/pkg" && tar --owner=0 --group=0 -czf "$WORK/package.tgz" bin ui compose)

# spk layout
mkdir -p "$WORK/spk"
sed "s/@VERSION@/$VERSION-$BUILD/" "$HERE/package/INFO.in" > "$WORK/spk/INFO"
echo "extractsize=\"$(du -sk "$WORK/pkg" | cut -f1)\"" >> "$WORK/spk/INFO"
cp "$WORK/package.tgz" "$WORK/spk/"
cp -R "$HERE/package/scripts" "$HERE/package/conf" "$WORK/spk/"
cp "$HERE/package/PACKAGE_ICON.PNG" "$HERE/package/PACKAGE_ICON_256.PNG" "$WORK/spk/"
chmod 755 "$WORK/spk/scripts/"*

mkdir -p "$OUT"
OUT="$(cd "$OUT" && pwd)"
NAME="DeBarrier-$VERSION-x86_64.spk"
(cd "$WORK/spk" && tar --owner=0 --group=0 -cf "$OUT/$NAME" INFO package.tgz scripts conf PACKAGE_ICON.PNG PACKAGE_ICON_256.PNG)
echo "$OUT/$NAME"
