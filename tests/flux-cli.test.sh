#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FLUX="${ROOT_DIR}/flux"
TMP_OUT="${TMPDIR:-/tmp}/flux-cli-test.out"
trap 'rm -f "${TMP_OUT}"' EXIT

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

assert_contains() {
  local haystack=$1
  local needle=$2
  [[ "${haystack}" == *"${needle}"* ]] || fail "expected output to contain: ${needle}"
}

run_flux() {
  FLUX_DRY_RUN=1 FLUX_STACK_DIR="${ROOT_DIR}/tests/fixtures/missing-stack" "${FLUX}" "$@"
}

output=$(run_flux help 2>&1 || true)
assert_contains "${output}" "flux server dev start|stop|restart|status"
assert_contains "${output}" "flux daemon list"

output=$(run_flux daemon list 2>&1)
assert_contains "${output}" "orchestrator"
assert_contains "${output}" "fluxaos-daemon"

output=$(run_flux orchestrator status 2>&1)
assert_contains "${output}" "systemctl --user status fluxaos-daemon"

output=$(run_flux daemon orchestrator install 2>&1)
assert_contains "${output}" "mkdir -p"
assert_contains "${output}" "cp "
assert_contains "${output}" "systemctl --user enable fluxaos-daemon"

if run_flux daemon cleanup status >"${TMP_OUT}" 2>&1; then
  fail "unknown daemon unexpectedly succeeded"
fi
assert_contains "$(cat "${TMP_OUT}")" "unknown daemon: cleanup"

output=$(run_flux server dev start 2>&1)
assert_contains "${output}" "npm run dev -- -p 3004"

output=$(run_flux server prod status 2>&1)
assert_contains "${output}" "docker"
assert_contains "${output}" "compose"
assert_contains "${output}" "ps"
assert_contains "${output}" "fluxaos-web"

echo "flux-cli tests passed"
