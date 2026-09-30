#!/bin/sh
# Package dist/ as the release bundle Tenkai pins by SHA-256.
# Usage: VERSION=v1.2.3 sh scripts/package.sh  ->  release/tenkai-console-v1.2.3.zip + SHA256SUMS
set -eu
: "${VERSION:?set VERSION, for example v0.1.0}"
test -f dist/index.html || { echo "dist/ missing; run pnpm build" >&2; exit 1; }
if grep -Eq '(src|href)="(https?:)?//' dist/index.html; then
  echo "dist/index.html references an external host" >&2
  exit 1
fi
rm -rf release && mkdir release
name="tenkai-console-${VERSION}.zip"
# Fixed timestamps and sorted entries keep the zip reproducible for a given build.
(cd dist && find . -type f | LC_ALL=C sort | TZ=UTC xargs touch -t 198001010000 && find . -type f | LC_ALL=C sort | zip -X -q "../release/${name}" -@)
(cd release && sha256sum "${name}" > SHA256SUMS 2>/dev/null || shasum -a 256 "${name}" > SHA256SUMS)
cat release/SHA256SUMS
