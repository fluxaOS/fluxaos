#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STATE_DIR="${FLUX_STATE_DIR:-${ROOT_DIR}/.flux}"
DEV_PID_FILE="${STATE_DIR}/server-dev.pid"
DEV_LOG_FILE="${STATE_DIR}/server-dev.log"
DEV_PORT="${FLUX_DEV_PORT:-3004}"
DEV_HOST="${FLUX_DEV_HOST:-192.168.54.101}"
DEV_DNS="${FLUX_DEV_DNS:-dev-flux.jdp21.com}"
STACK_DIR="${FLUX_STACK_DIR:-/mnt/stacks/docker/fluxaos}"
UAT_HOST="${FLUX_UAT_HOST:-192.168.54.101}"
UAT_PORT="${FLUX_UAT_PORT:-3003}"
UAT_DNS="${FLUX_UAT_DNS:-uat-flux.jdp21.com}"
SYSTEMD_USER_DIR="${FLUX_SYSTEMD_USER_DIR:-${HOME}/.config/systemd/user}"
DAEMON_UNIT_SOURCE="${ROOT_DIR}/ops/systemd/fluxaos-daemon.service"
DAEMON_UNIT_NAME="fluxaos-daemon"
DRY_RUN="${FLUX_DRY_RUN:-0}"

usage() {
  cat <<'USAGE'
Usage:
  flux server dev start|stop|restart|reset|status
  flux server uat start|stop|restart|status|build
  flux daemon list
  flux daemon orchestrator start|stop|restart|status|install|uninstall
  flux orchestrator start|stop|restart|status|install|uninstall

Notes:
  server dev runs Next.js on port 3004 by default.
  server dev reset stops the server, nukes + reseeds the DB, then starts fresh.
  server uat manages the Docker Compose web service in /mnt/stacks/docker/fluxaos.
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

install_daemon_unit() {
  if [[ "${DRY_RUN}" == "1" ]]; then
    echo "+ mkdir -p ${SYSTEMD_USER_DIR}"
    echo "+ install ${DAEMON_UNIT_SOURCE} ${SYSTEMD_USER_DIR}/${DAEMON_UNIT_NAME}.service with WorkingDirectory=${ROOT_DIR}"
    return 0
  fi
  mkdir -p "${SYSTEMD_USER_DIR}"
  sed "s|%h/dev/fluxaos|${ROOT_DIR}|g" "${DAEMON_UNIT_SOURCE}" >"${SYSTEMD_USER_DIR}/${DAEMON_UNIT_NAME}.service"
}

is_running_pid() {
  local pid=$1
  [[ -n "${pid}" ]] && kill -0 "${pid}" >/dev/null 2>&1
}

read_dev_pid() {
  [[ -f "${DEV_PID_FILE}" ]] && cat "${DEV_PID_FILE}"
}

find_dev_port_pid() {
  local line
  line="$(ss -ltnp "sport = :${DEV_PORT}" 2>/dev/null | awk 'NR > 1 { print; exit }' || true)"
  [[ "${line}" =~ pid=([0-9]+) ]] && echo "${BASH_REMATCH[1]}"
}

print_dev_endpoint() {
  echo "endpoint: ${DEV_DNS} = ${DEV_HOST}:${DEV_PORT}"
}

print_uat_endpoint() {
  echo "endpoint: ${UAT_DNS} = ${UAT_HOST}:${UAT_PORT}"
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
      if [[ "${DRY_RUN}" == "1" ]]; then
        echo "+ cd ${ROOT_DIR} && npm run dev -- -p ${DEV_PORT} >${DEV_LOG_FILE} 2>&1 & echo \$! >${DEV_PID_FILE}"
        return 0
      fi
      mkdir -p "${STATE_DIR}"
      local pid
      pid="$(find_dev_port_pid || true)"
      if [[ -n "${pid}" ]] && is_running_pid "${pid}"; then
        echo "${pid}" >"${DEV_PID_FILE}"
        echo "server dev already running pid=${pid} port=${DEV_PORT}"
        return 0
      fi
      pid="$(read_dev_pid || true)"
      if [[ -n "${pid}" ]] && is_running_pid "${pid}"; then
        echo "server dev starting pid=${pid} port=${DEV_PORT}"
        return 0
      fi
      (cd "${ROOT_DIR}" && nohup npm run dev -- -p "${DEV_PORT}" >"${DEV_LOG_FILE}" 2>&1 & echo $! >"${DEV_PID_FILE}")
      echo "server dev started pid=$(cat "${DEV_PID_FILE}") port=${DEV_PORT} log=${DEV_LOG_FILE}"
      ;;
    stop)
      local pid
      pid="$(read_dev_pid || true)"
      local stopped=0
      if [[ -n "${pid}" ]] && is_running_pid "${pid}"; then
        run kill "${pid}"
        echo "server dev stopped pid=${pid}"
        stopped=1
      fi
      pid="$(find_dev_port_pid || true)"
      if [[ -n "${pid}" ]] && is_running_pid "${pid}"; then
        run kill "${pid}"
        echo "server dev stopped listener pid=${pid}"
        stopped=1
      fi
      if [[ "${stopped}" == "0" ]]; then
        echo "server dev stopped"
        rm -f "${DEV_PID_FILE}"
        return 0
      fi
      rm -f "${DEV_PID_FILE}"
      ;;
    restart)
      server_dev stop
      server_dev start
      ;;
    reset)
      server_dev stop
      echo "nuking database..."
      run npx tsx "${ROOT_DIR}/src/scripts/db/nuke.ts"
      echo "seeding database..."
      run npm --prefix "${ROOT_DIR}" run db:seed
      server_dev start
      ;;
    status)
      print_dev_endpoint
      local pid
      pid="$(find_dev_port_pid || true)"
      if [[ -n "${pid}" ]] && is_running_pid "${pid}"; then
        echo "${pid}" >"${DEV_PID_FILE}"
        echo "server dev running pid=${pid} port=${DEV_PORT} log=${DEV_LOG_FILE}"
        return 0
      fi
      pid="$(read_dev_pid || true)"
      if [[ -n "${pid}" ]] && is_running_pid "${pid}"; then
        echo "server dev starting pid=${pid} port=${DEV_PORT} log=${DEV_LOG_FILE}"
      else
        echo "server dev stopped"
      fi
      ;;
    *) usage; fail "unknown server dev action: ${action:-<missing>}" ;;
  esac
}

server_uat() {
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
      print_uat_endpoint
      run docker compose --project-directory "${STACK_DIR}" ps fluxaos-web
      ;;
    build)
      [[ -x "${STACK_DIR}/build.sh" ]] || fail "UAT build script is not executable: ${STACK_DIR}/build.sh"
      run "${STACK_DIR}/build.sh"
      ;;
    *) usage; fail "unknown server uat action: ${action:-<missing>}" ;;
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
      if [[ "${DRY_RUN}" == "1" ]]; then
        run systemctl --user status "${unit}" --no-pager
      else
        systemctl --user status "${unit}" --no-pager || true
      fi
      ;;
    install)
      [[ -f "${DAEMON_UNIT_SOURCE}" ]] || fail "unit source not found: ${DAEMON_UNIT_SOURCE}"
      install_daemon_unit
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
        uat) server_uat "${1:-}" ;;
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
