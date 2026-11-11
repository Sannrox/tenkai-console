#!/bin/sh
# Install Playwright Chromium for CI, retrying runner apt DNS failures.
#
# Usage:
#   sh scripts/playwright-install.sh
#   sh scripts/playwright-install.sh self-test
#
# Runs `pnpm exec playwright install --with-deps chromium` up to 4 times,
# sleeping 15, 30, then 60 seconds. `--with-deps` calls apt; GitHub runner
# DNS to Ubuntu archives fails some jobs before e2e. Exits with the last
# install error once attempts run out. A runner whose DNS is down for the
# whole job still needs a rerun.
set -eu

retry_install() {
  attempts=$1
  delay=$2
  shift 2
  try=1
  while :; do
    if "$@"; then
      return 0
    fi
    if [ "$try" -ge "$attempts" ]; then
      echo "playwright-install: giving up after $try attempts" >&2
      return 1
    fi
    echo "playwright-install: attempt $try failed; retrying in ${delay}s" >&2
    sleep "$delay"
    try=$((try + 1))
    delay=$((delay * 2))
  done
}

self_test() {
  root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
  workflow="$root/.github/workflows/ci.yml"
  grep -F 'sh scripts/playwright-install.sh self-test' "$workflow" >/dev/null \
    || { echo "ci.yml must run playwright-install.sh self-test" >&2; exit 1; }
  grep -E '^[[:space:]]+- run: sh scripts/playwright-install.sh$' "$workflow" >/dev/null \
    || { echo "ci.yml must call sh scripts/playwright-install.sh" >&2; exit 1; }
  grep -E '^[[:space:]]+- run: pnpm exec playwright install --with-deps' "$workflow" >/dev/null \
    && { echo "ci.yml must not call playwright install --with-deps directly" >&2; exit 1; }

  tmp=$(mktemp -d "${TMPDIR:-/tmp}/pw-install.$$.XXXXXX")
  trap 'rm -rf "$tmp"' EXIT

  ok="$tmp/ok"
  printf '#!/bin/sh\nexit 0\n' >"$ok"
  chmod +x "$ok"
  retry_install 4 0 "$ok" || { echo "expected first-try success" >&2; exit 1; }

  flaky="$tmp/flaky"
  count="$tmp/flaky.count"
  printf '#!/bin/sh\nn="%s"\ni=`cat "$n" 2>/dev/null || echo 0`\ni=$((i + 1))\necho "$i" >"$n"\n[ "$i" -ge 2 ]\n' "$count" >"$flaky"
  chmod +x "$flaky"
  retry_install 4 0 "$flaky" || { echo "expected retry then success" >&2; exit 1; }
  [ "$(cat "$count")" = 2 ] || { echo "expected two attempts, got $(cat "$count")" >&2; exit 1; }

  if retry_install 2 0 "$tmp/does-not-exist"; then
    echo "expected missing command to fail" >&2
    exit 1
  fi

  echo "playwright-install self-test passed"
}

case "${1:-}" in
  self-test) self_test ;;
  "") retry_install 4 15 pnpm exec playwright install --with-deps chromium ;;
  *)
    echo "usage: playwright-install.sh [self-test]" >&2
    exit 2
    ;;
esac
