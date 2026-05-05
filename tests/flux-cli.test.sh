#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FLUX="${ROOT_DIR}/flux"
TMP_OUT="${TMPDIR:-/tmp}/flux-cli-test.out"
TMP_STATE="$(mktemp -d "${TMPDIR:-/tmp}/flux-cli-state.XXXXXX")"
SERVER_PID=""
trap '[[ -n "${SERVER_PID}" ]] && kill "${SERVER_PID}" >/dev/null 2>&1 || true; rm -f "${TMP_OUT}"; rm -rf "${TMP_STATE}"' EXIT

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
assert_contains "${output}" "flux server dev start|stop|restart|reset|status"
assert_contains "${output}" "flux server uat start|stop|restart|status|build"
assert_contains "${output}" "flux daemon list"

output=$(run_flux daemon list 2>&1)
assert_contains "${output}" "orchestrator"
assert_contains "${output}" "fluxaos-daemon"

output=$(run_flux orchestrator status 2>&1)
assert_contains "${output}" "systemctl --user status fluxaos-daemon"

output=$(run_flux daemon orchestrator install 2>&1)
assert_contains "${output}" "mkdir -p"
assert_contains "${output}" "WorkingDirectory="
assert_contains "${output}" "systemctl --user enable fluxaos-daemon"

if run_flux daemon cleanup status >"${TMP_OUT}" 2>&1; then
  fail "unknown daemon unexpectedly succeeded"
fi
assert_contains "$(cat "${TMP_OUT}")" "unknown daemon: cleanup"

output=$(run_flux server dev start 2>&1)
assert_contains "${output}" "npm run dev -- -p 3004"

output=$(run_flux server dev stop 2>&1)
assert_contains "${output}" "server dev stopped"

output=$(run_flux server dev restart 2>&1)
assert_contains "${output}" "server dev stopped"
assert_contains "${output}" "npm run dev -- -p 3004"

output=$(run_flux server dev reset 2>&1)
assert_contains "${output}" "server dev stopped"
assert_contains "${output}" "nuke.ts"
assert_contains "${output}" "db:seed"
assert_contains "${output}" "npm run dev -- -p 3004"

output=$(run_flux server dev status 2>&1)
assert_contains "${output}" "dev-flux.jdp21.com"
assert_contains "${output}" "192.168.54.101:3004"

output=$(run_flux server uat start 2>&1)
assert_contains "${output}" "docker"
assert_contains "${output}" "compose"
assert_contains "${output}" "up"
assert_contains "${output}" "fluxaos-web"

output=$(run_flux server uat stop 2>&1)
assert_contains "${output}" "docker"
assert_contains "${output}" "compose"
assert_contains "${output}" "stop"
assert_contains "${output}" "fluxaos-web"

output=$(run_flux server uat restart 2>&1)
assert_contains "${output}" "docker"
assert_contains "${output}" "compose"
assert_contains "${output}" "restart"
assert_contains "${output}" "fluxaos-web"

output=$(run_flux server uat status 2>&1)
assert_contains "${output}" "flux.jdp21.com"
assert_contains "${output}" "192.168.54.101:3003"
assert_contains "${output}" "docker"
assert_contains "${output}" "compose"
assert_contains "${output}" "ps"
assert_contains "${output}" "fluxaos-web"

output=$(FLUX_DRY_RUN=1 FLUX_STACK_DIR="${ROOT_DIR}/tests/fixtures/missing-stack" "${FLUX}" server uat build 2>&1 || true)
assert_contains "${output}" "UAT build script is not executable"

output=$(run_flux daemon orchestrator start 2>&1)
assert_contains "${output}" "systemctl --user start fluxaos-daemon"

output=$(run_flux daemon orchestrator stop 2>&1)
assert_contains "${output}" "systemctl --user stop fluxaos-daemon"

output=$(run_flux daemon orchestrator restart 2>&1)
assert_contains "${output}" "systemctl --user restart fluxaos-daemon"

output=$(run_flux daemon orchestrator status 2>&1)
assert_contains "${output}" "systemctl --user status fluxaos-daemon"

output=$(run_flux daemon orchestrator uninstall 2>&1)
assert_contains "${output}" "systemctl --user disable --now fluxaos-daemon"
assert_contains "${output}" "rm -f"

output=$(run_flux orchestrator start 2>&1)
assert_contains "${output}" "systemctl --user start fluxaos-daemon"

output=$(run_flux orchestrator stop 2>&1)
assert_contains "${output}" "systemctl --user stop fluxaos-daemon"

output=$(run_flux orchestrator restart 2>&1)
assert_contains "${output}" "systemctl --user restart fluxaos-daemon"

output=$(run_flux orchestrator install 2>&1)
assert_contains "${output}" "systemctl --user enable fluxaos-daemon"

output=$(run_flux orchestrator uninstall 2>&1)
assert_contains "${output}" "uninstalled fluxaos-daemon"

TEST_PORT=43104
node -e "require('node:http').createServer((_, res) => res.end('ok')).listen(${TEST_PORT}, '0.0.0.0')" &
SERVER_PID=$!
sleep 1

output=$(FLUX_STATE_DIR="${TMP_STATE}" FLUX_DEV_PORT="${TEST_PORT}" "${FLUX}" server dev status 2>&1)
assert_contains "${output}" "server dev running"
assert_contains "${output}" "port=${TEST_PORT}"

output=$(FLUX_STATE_DIR="${TMP_STATE}" FLUX_DEV_PORT="${TEST_PORT}" "${FLUX}" server dev start 2>&1)
assert_contains "${output}" "server dev already running"
assert_contains "${output}" "port=${TEST_PORT}"

output=$(FLUX_STATE_DIR="${TMP_STATE}" FLUX_DEV_PORT="${TEST_PORT}" "${FLUX}" server dev stop 2>&1)
assert_contains "${output}" "server dev stopped"
sleep 1
if kill -0 "${SERVER_PID}" >/dev/null 2>&1; then
  fail "server dev stop did not terminate listener on port ${TEST_PORT}"
fi
SERVER_PID=""

echo "flux-cli tests passed"
