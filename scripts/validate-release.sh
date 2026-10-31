#!/usr/bin/env bash
# Local/CI checks for the v* release path. Does not publish or attest.
set -euo pipefail

ROOT_PATH="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_PATH"

fail() {
  printf 'validate-release: %s\n' "$1" >&2
  exit 1
}

python3 scripts/changelog-notes.py --self-test
python3 scripts/release-manifest.py --self-test
python3 scripts/release-sbom.py --self-test
bash scripts/verify-release-tag.sh self-test

workflow=".github/workflows/release.yml"
[[ -f "$workflow" ]] || fail "missing ${workflow}"
grep -F 'tags: ["v*"]' "$workflow" >/dev/null || fail "${workflow} must trigger on v* tags"
grep -F "changelog-notes.py" "$workflow" >/dev/null || fail "${workflow} must take GitHub Release notes from CHANGELOG"
grep -F "if: github.event_name == 'push' && startsWith(github.ref, 'refs/tags/v')" "$workflow" >/dev/null || fail "${workflow} must gate publish/attest on tag pushes"
grep -F "needs.package.result == 'success'" "$workflow" >/dev/null || fail "${workflow} must not attest or publish unless package succeeded"
grep -F "needs.attest.result == 'success'" "$workflow" >/dev/null || fail "${workflow} must not publish unless attest succeeded"
grep -F "id-token: write" "$workflow" >/dev/null || fail "${workflow} must request id-token for provenance"
grep -F "attestations: write" "$workflow" >/dev/null || fail "${workflow} must request attestations permission"
head_perm="$(sed -n '1,/^jobs:/p' "$workflow")"
if printf '%s\n' "$head_perm" | grep -F "attestations: write" >/dev/null; then
  fail "${workflow} must not grant attestations: write at workflow level"
fi
if grep -E '(:latest|tag: latest|tags: latest)' "$workflow" >/dev/null; then
  fail "${workflow} must not produce a latest image tag"
fi

tmp="$(mktemp -d /tmp/tcrp.XXXXXX)"
trap 'rm -rf "$tmp"' EXIT
mkdir -p "${tmp}/release"
printf 'fake\n' >"${tmp}/release/tenkai-console-v0.2.0.zip"
ROOT_PATH="$ROOT_PATH" bash scripts/release-package.sh --out "${tmp}/release" --skip-build --skip-test --skip-github --git-sha "$(git rev-parse HEAD)"
[[ -f "${tmp}/release/tenkai-console-release.json" ]] || fail "dry-run package did not write a manifest"
[[ -f "${tmp}/release/tenkai-console.cdx.json" ]] || fail "dry-run package did not write an SBOM"
python3 -c "import json,sys; m=json.loads(open(sys.argv[1]).read()); assert m['schema']=='tenkai.family-release-manifest.v1'; assert m['component']=='tenkai-console'; assert m['images']==[]; assert 'latest' not in json.dumps(m)" "${tmp}/release/tenkai-console-release.json"
[[ ! -f "${tmp}/release/published" ]] || fail "dry-run must not publish"

notes_out="${tmp}/notes"
mkdir -p "$notes_out"
ROOT_PATH="$ROOT_PATH" bash scripts/release-package.sh --out "$notes_out" --skip-build --skip-test --skip-github --tag v0.2.0 --git-sha "$(git rev-parse HEAD)"
[[ -s "${notes_out}/RELEASE_NOTES.md" ]] || fail "tag dry-run did not write CHANGELOG notes"
grep -F "request one tick from Delivery" "${notes_out}/RELEASE_NOTES.md" >/dev/null || fail "CHANGELOG notes missing expected 0.2.0 body"
python3 -c "import json,sys; m=json.loads(open(sys.argv[1]).read()); assert m['version']=='0.2.0'; assert m['tag']=='v0.2.0'; assert m['schema']=='tenkai.family-release-manifest.v1'" "${notes_out}/tenkai-console-release.json"

printf 'validate-release passed\n'
