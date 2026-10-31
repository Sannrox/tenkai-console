#!/usr/bin/env bash
# Build release artifacts into --out without publishing or attesting.
# Vite writes the app to dist/; this script writes the zip and family
# artifacts to --out (default: release/).
#
# Usage:
#   bash scripts/release-package.sh --out release [--tag vX.Y.Z] [--git-sha SHA]
#        [--skip-build] [--skip-test] [--skip-github]
set -euo pipefail

ROOT_PATH="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_PATH"

OUT=""
TAG=""
GIT_SHA=""
SKIP_BUILD=0
SKIP_TEST=0
SKIP_GITHUB=0

fail() {
  printf 'release-package: %s\n' "$1" >&2
  exit 1
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --out) OUT="${2:-}"; shift 2 ;;
    --tag) TAG="${2:-}"; shift 2 ;;
    --git-sha) GIT_SHA="${2:-}"; shift 2 ;;
    --skip-build) SKIP_BUILD=1; shift ;;
    --skip-test) SKIP_TEST=1; shift ;;
    --skip-github) SKIP_GITHUB=1; shift ;;
    *) fail "unknown argument: $1" ;;
  esac
done

[[ -n "$OUT" ]] || fail "usage: $0 --out release [--tag vX.Y.Z] [--git-sha SHA]"
mkdir -p "$OUT"
OUT="$(cd "$OUT" && pwd)"
[[ "$OUT" != "$ROOT_PATH/dist" ]] || fail "--out must not be dist/ (Vite build output)"

workspace_version() {
  python3 -c 'import json,sys; data=json.load(open(sys.argv[1])); v=data.get("version"); sys.exit("package.json has no version") if not v else print(v)' "$ROOT_PATH/package.json"
}

VERSION="$(workspace_version)"
if [[ -n "$TAG" ]]; then
  [[ "${TAG#v}" == "$VERSION" ]] || fail "tag ${TAG} does not match workspace version ${VERSION}"
fi
if [[ -z "$GIT_SHA" ]]; then
  GIT_SHA="$(git rev-parse HEAD)"
fi
[[ "$GIT_SHA" =~ ^[0-9a-f]{40}$ ]] || fail "git sha must be a full lowercase SHA"

if [[ "$SKIP_TEST" -eq 0 ]]; then
  pnpm api:check
  pnpm typecheck
  pnpm lint
  pnpm format:check
  pnpm test
fi

if [[ "$SKIP_BUILD" -eq 0 ]]; then
  pnpm build
  DEST="$OUT" VERSION="v${VERSION}" sh "$ROOT_PATH/scripts/package.sh"
fi

if [[ -n "$TAG" ]]; then
  python3 "$ROOT_PATH/scripts/changelog-notes.py" "$VERSION" >"${OUT}/RELEASE_NOTES.md"
fi

python3 "$ROOT_PATH/scripts/release-sbom.py" "${OUT}/tenkai-console.cdx.json"

python3 -c '
import hashlib, pathlib, sys
out = pathlib.Path(sys.argv[1])
lines = []
for path in sorted(p for p in out.iterdir() if p.is_file() and p.name != "SHA256SUMS"):
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    lines.append(f"{digest}  {path.name}")
(out / "SHA256SUMS").write_text("\n".join(lines) + ("\n" if lines else ""))
' "$OUT"

LABEL_ARGS=()
if [[ -n "$TAG" && "$SKIP_GITHUB" -eq 0 ]] && command -v gh >/dev/null 2>&1; then
  prev="$(git tag --list 'v*' --sort=-version:refname)"
  prev="$(awk -v cur="$TAG" '$0 != cur { print; exit }' <<<"$prev")"
  search=()
  if [[ -n "$prev" ]]; then
    since="$(git log -1 --format=%cs "$prev" 2>/dev/null || true)"
    if [[ -n "$since" ]]; then
      search+=(--search "merged:>=${since}")
    fi
  fi
  while IFS= read -r label; do
    [[ -n "$label" ]] && LABEL_ARGS+=("--label" "$label")
  done < <(gh pr list --state merged --limit 100 "${search[@]}" --json labels --jq '.[].labels[].name' 2>/dev/null || true)
fi

manifest_args=(
  --component tenkai-console
  --version "$VERSION"
  --git-sha "$GIT_SHA"
  --dist "$OUT"
  --out "${OUT}/tenkai-console-release.json"
)
if [[ -n "$TAG" ]]; then
  manifest_args+=(--tag "$TAG")
fi
if [[ ${#LABEL_ARGS[@]} -gt 0 ]]; then
  manifest_args+=("${LABEL_ARGS[@]}")
fi
python3 "$ROOT_PATH/scripts/release-manifest.py" "${manifest_args[@]}"

echo "version=${VERSION}"
echo "artifacts in ${OUT}:"
cat "${OUT}/SHA256SUMS"
echo "images: none (this component does not publish a container image)"
