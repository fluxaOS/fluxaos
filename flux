#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STATE_DIR="${FLUX_STATE_DIR:-${ROOT_DIR}/.flux}"
DEV_PID_FILE="${STATE_DIR}/server-dev.pid"
DEV_LOG_FILE="${STATE_DIR}/server-dev.log"
DEV_PORT="${FLUX_DEV_PORT:-3004}"
STACK_DIR="${FLUX_STACK_DIR:-/mnt/stacks/docker/fluxaos}"
SYSTEMD_USER_DIR="${FLUX_SYSTEMD_USER_DIR:-${HOME}/.config/systemd/user}"
DAEMON_UNIT_SOURCE="${ROOT_DIR}/ops/systemd/fluxaos-daemon.service"
DAEMON_UNIT_NAME="fluxaos-daemon"
DRY_RUN="${FLUX_DRY_RUN:-0}"

usage() {
  cat <<'USAGE'
Usage:
  flux server dev start|stop|restart|status
  flux server prod start|stop|restart|status|build
  flux daemon list
  flux daemon orchestrator start|stop|restart|status|install|uninstall
  flux orchestrator start|stop|restart|status|install|uninstall

Notes:
  server dev runs Next.js on port 3004 by default.
  server prod manages the Docker Compose web service in /mnt/stacks/docker/fluxaos.
  orchestrator is an alias for daemon orchestrator.
USAGE
}

fail() {
  echo "error: $*" >&2
  exit 1
}

run() {
  if [[ "${DRY_RUN}" == "1" ]]; then
    printf '+'
    printf ' %q' "$@"
    printf '\n'
    return 0
  fi
  "$@"
}

is_running_pid() {
  local pid=$1
  [[ -n "${pid}" ]] && kill -0 "${pid}" >/dev/null 2>&1
}

read_dev_pid() {
  [[ -f "${DEV_PID_FILE}" ]] && cat "${DEV_PID_FILE}"
}

require_stack_dir() {
  [[ "${DRY_RUN}" == "1" ]] && return 0
  [[ -d "${STACK_DIR}" ]] || fail "production stack directory not found: ${STACK_DIR}"
}

daemon_unit_for() {
  local name=$1
  case "${name}" in
    orchestrator) echo "${DAEMON_UNIT_NAME}" ;;
    *) fail "unknown daemon: ${name}" ;;
  esac
}

server_dev() {
  local action=${1:-}
  case "${action}" in
    start)
      mkdir -p "${STATE_DIR}"
      local pid
      pid="$(read_dev_pid || true)"
      if [[ -n "${pid}" ]] && is_running_pid "${pid}"; then
        echo "server dev already running pid=${pid} port=${DEV_PORT}"
        return 0
      fi
      if [[ "${DRY_RUN}" == "1" ]]; then
        echo "+ cd ${ROOT_DIR} && npm run dev -- -p ${DEV_PORT} >${DEV_LOG_FILE} 2>&1 & echo \$! >${DEV_PID_FILE}"
        return 0
      fi
      (cd "${ROOT_DIR}" && nohup npm run dev -- -p "${DEV_PORT}" >"${DEV_LOG_FILE}" 2>&1 & echo $! >"${DEV_PID_FILE}")
      echo "server dev started pid=$(cat "${DEV_PID_FILE}") port=${DEV_PORT} log=${DEV_LOG_FILE}"
      ;;
    stop)
      local pid
      pid="$(read_dev_pid || true)"
      if [[ -z "${pid}" ]] || ! is_running_pid "${pid}"; then
        echo "server dev stopped"
        rm -f "${DEV_PID_FILE}"
        return 0
      fi
      run kill "${pid}"
      rm -f "${DEV_PID_FILE}"
      echo "server dev stopped pid=${pid}"
      ;;
    restart)
      server_dev stop
      server_dev start
      ;;
    status)
      local pid
      pid="$(read_dev_pid || true)"
      if [[ -n "${pid}" ]] && is_running_pid "${pid}"; then
        echo "server dev running pid=${pid} port=${DEV_PORT} log=${DEV_LOG_FILE}"
      else
        echo "server dev stopped"
      fi
      ;;
    *) usage; fail "unknown server dev action: ${action:-<missing>}" ;;
  esac
}

server_prod() {
  local action=${1:-}
  case "${action}" in
    start)
      require_stack_dir
      run docker compose --project-directory "${STACK_DIR}" up -d fluxaos-web
      ;;
    stop)
      require_stack_dir
      run docker compose --project-directory "${STACK_DIR}" stop fluxaos-web
      ;;
    restart)
      require_stack_dir
      run docker compose --project-directory "${STACK_DIR}" restart fluxaos-web
      ;;
    status)
      require_stack_dir
      run docker compose --project-directory "${STACK_DIR}" ps fluxaos-web
      ;;
    build)
      [[ -x "${STACK_DIR}/build.sh" ]] || fail "production build script is not executable: ${STACK_DIR}/build.sh"
      run "${STACK_DIR}/build.sh"
      ;;
    *) usage; fail "unknown server prod action: ${action:-<missing>}" ;;
  esac
}

daemon_list() {
  echo "orchestrator ${DAEMON_UNIT_NAME}"
}

daemon_action() {
  local name=${1:-}
  local action=${2:-}
  [[ -n "${name}" ]] || fail "daemon name required"
  local unit
  unit="$(daemon_unit_for "${name}")"

  case "${action}" in
    start)
      run systemctl --user start "${unit}"
      ;;
    stop)
      run systemctl --user stop "${unit}"
      ;;
    restart)
      run systemctl --user restart "${unit}"
      ;;
    status)
      run systemctl --user status "${unit}" --no-pager
      ;;
    install)
      [[ -f "${DAEMON_UNIT_SOURCE}" ]] || fail "unit source not found: ${DAEMON_UNIT_SOURCE}"
      run mkdir -p "${SYSTEMD_USER_DIR}"
      run cp "${DAEMON_UNIT_SOURCE}" "${SYSTEMD_USER_DIR}/${unit}.service"
      run systemctl --user daemon-reload
      run systemctl --user enable "${unit}"
      echo "installed ${unit}; run 'flux daemon ${name} start' to start it"
      ;;
    uninstall)
      run systemctl --user disable --now "${unit}"
      run rm -f "${SYSTEMD_USER_DIR}/${unit}.service"
      run systemctl --user daemon-reload
      echo "uninstalled ${unit}"
      ;;
    *) usage; fail "unknown daemon action: ${action:-<missing>}" ;;
  esac
}

main() {
  local group=${1:-help}
  shift || true

  case "${group}" in
    help|-h|--help)
      usage
      ;;
    server)
      local mode=${1:-}
      shift || true
      case "${mode}" in
        dev) server_dev "${1:-}" ;;
        prod) server_prod "${1:-}" ;;
        *) usage; fail "unknown server mode: ${mode:-<missing>}" ;;
      esac
      ;;
    daemon)
      if [[ "${1:-}" == "list" ]]; then
        daemon_list
        return 0
      fi
      daemon_action "${1:-}" "${2:-}"
      ;;
    orchestrator)
      daemon_action orchestrator "${1:-}"
      ;;
    *)
      usage
      fail "unknown command group: ${group}"
      ;;
  esac
}

main "$@"
