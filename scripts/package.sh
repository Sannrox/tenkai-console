#!/bin/sh
# Package dist/ as the release bundle Tenkai pins by SHA-256.
# Usage: VERSION=v1.2.3 sh scripts/package.sh  ->  release/tenkai-console-v1.2.3.zip + SHA256SUMS
# Optional DEST=dir writes there instead of release/. DEST must not be dist/.
set -eu
: "${VERSION:?set VERSION, for example v0.1.0}"
test -f dist/index.html || { echo "dist/ missing; run pnpm build" >&2; exit 1; }
if grep -Eq '(src|href)="(https?:)?//' dist/index.html; then
  echo "dist/index.html references an external host" >&2
  exit 1
fi
dest="${DEST:-release}"
[ "$dest" != "dist" ] && [ "$dest" != "./dist" ] || {
  echo "DEST must not be dist/" >&2
  exit 1
}
rm -rf "${dest}"
mkdir -p "${dest}"
dest="$(cd "${dest}" && pwd)"
[ "$dest" != "$(cd dist && pwd)" ] || {
  echo "DEST must not be dist/" >&2
  exit 1
}
name="tenkai-console-${VERSION}.zip"
# Fixed timestamps and sorted entries keep the zip reproducible for a given build.
(cd dist && find . -type f | LC_ALL=C sort | TZ=UTC xargs touch -t 198001010000 && find . -type f | LC_ALL=C sort | zip -X -q "${dest}/${name}" -@)
(cd "${dest}" && sha256sum "${name}" > SHA256SUMS 2>/dev/null || shasum -a 256 "${name}" > SHA256SUMS)
cat "${dest}/SHA256SUMS"
