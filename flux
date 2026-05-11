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

# Supabase project refs — the source of truth for "dev points at dev, UAT
# points at UAT". The FLX-123 regression happened because two recovery
# sessions reconstructed env files from container env and silently wrote
# the wrong ref. `flux env audit` (below) catches that before it ships.
DEV_ENV_FILE_DEFAULT="${ROOT_DIR}/.env.local"
DEV_ENV_FILE_FALLBACK="${ROOT_DIR}/.env"
UAT_ENV_FILE="${FLUX_UAT_ENV_FILE:-${STACK_DIR}/fluxaos.env}"
DEV_SUPABASE_PROJECT_REF="${FLUX_DEV_SUPABASE_PROJECT_REF:-dpdjlnpvxkepkwzwuvim}"
UAT_SUPABASE_PROJECT_REF="${FLUX_UAT_SUPABASE_PROJECT_REF:-zesinfsluyxiwzldeffa}"
SYSTEMD_USER_DIR="${FLUX_SYSTEMD_USER_DIR:-${HOME}/.config/systemd/user}"
DAEMON_UNIT_SOURCE="${ROOT_DIR}/ops/systemd/fluxaos-daemon.service"
DAEMON_UNIT_NAME="fluxaos-daemon"
DRY_RUN="${FLUX_DRY_RUN:-0}"

usage() {
  cat <<'USAGE'
Usage:
  flux server dev start|stop|restart|reset|status [--root <path>] [--port <port>]
  flux server uat start|stop|restart|status|build
  flux daemon list
  flux daemon orchestrator start|stop|restart|status|install|uninstall
  flux orchestrator start|stop|restart|status|install|uninstall
  flux env audit

Notes:
  server dev runs Next.js on port 3004 by default.
  --root <path>  serve a different directory (e.g. a worktree) instead of the repo root.
  --port <port>  listen on a different port (overrides FLUX_DEV_PORT and the 3004 default).
  server dev reset stops the server, nukes + reseeds the DB, then starts fresh.
  server uat manages the Docker Compose web service in /mnt/stacks/docker/fluxaos.
  orchestrator is an alias for daemon orchestrator.
  env audit verifies dev + UAT env files point at the right Supabase project refs (FLX-230).
USAGE
}

env_usage() {
  cat <<'USAGE'
Usage:
  flux env audit       Verify dev + UAT env files point at the right Supabase project refs.
  flux env -h          Show this message.

Reads:
  Dev: <repo>/.env.local (falls back to <repo>/.env if .env.local missing).
  UAT: /mnt/stacks/docker/fluxaos/fluxaos.env (override with FLUX_UAT_ENV_FILE).

Expected project refs (override with FLUX_DEV_SUPABASE_PROJECT_REF / FLUX_UAT_SUPABASE_PROJECT_REF):
  Dev: dpdjlnpvxkepkwzwuvim
  UAT: zesinfsluyxiwzldeffa

Exits 0 if both env files match. Exits 1 with remediation hints if either is wrong.
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
  shift || true

  # Parse --root and --port flags from remaining args.
  local dev_root="${ROOT_DIR}"
  local dev_port="${DEV_PORT}"
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --root)  dev_root="${2:?--root requires a path}"; shift 2 ;;
      --port)  dev_port="${2:?--port requires a port number}"; shift 2 ;;
      *) fail "unknown server dev option: $1" ;;
    esac
  done

  # Derive per-root state paths so multiple roots don't collide.
  local state_dir="${dev_root}/.flux"
  local pid_file="${state_dir}/server-dev.pid"
  local log_file="${state_dir}/server-dev.log"

  find_dev_port_pid_for() {
    local line
    line="$(ss -ltnp "sport = :${dev_port}" 2>/dev/null | awk 'NR > 1 { print; exit }' || true)"
    [[ "${line}" =~ pid=([0-9]+) ]] && echo "${BASH_REMATCH[1]}"
  }

  read_dev_pid_for() {
    [[ -f "${pid_file}" ]] && cat "${pid_file}"
  }

  case "${action}" in
    start)
      if [[ "${DRY_RUN}" == "1" ]]; then
        echo "+ cd ${dev_root} && npm run dev -- -p ${dev_port} >${log_file} 2>&1 & echo \$! >${pid_file}"
        return 0
      fi
      mkdir -p "${state_dir}"
      local pid
      pid="$(find_dev_port_pid_for || true)"
      if [[ -n "${pid}" ]] && is_running_pid "${pid}"; then
        echo "${pid}" >"${pid_file}"
        echo "server dev already running pid=${pid} port=${dev_port}"
        return 0
      fi
      pid="$(read_dev_pid_for || true)"
      if [[ -n "${pid}" ]] && is_running_pid "${pid}"; then
        echo "server dev starting pid=${pid} port=${dev_port}"
        return 0
      fi
      nohup bash -c "cd '${dev_root}' && exec npm run dev -- -H 0.0.0.0 -p '${dev_port}'" >"${log_file}" 2>&1 &
      echo $! >"${pid_file}"
      echo "server dev started pid=$(cat "${pid_file}") root=${dev_root} port=${dev_port} log=${log_file}"
      ;;
    stop)
      local pid
      pid="$(read_dev_pid_for || true)"
      local stopped=0
      if [[ -n "${pid}" ]] && is_running_pid "${pid}"; then
        run kill "${pid}"
        echo "server dev stopped pid=${pid}"
        stopped=1
      fi
      pid="$(find_dev_port_pid_for || true)"
      if [[ -n "${pid}" ]] && is_running_pid "${pid}"; then
        run kill "${pid}"
        echo "server dev stopped listener pid=${pid}"
        stopped=1
      fi
      if [[ "${stopped}" == "0" ]]; then
        echo "server dev stopped"
      fi
      rm -f "${pid_file}"
      ;;
    restart)
      server_dev stop --root "${dev_root}" --port "${dev_port}"
      server_dev start --root "${dev_root}" --port "${dev_port}"
      ;;
    reset)
      server_dev stop --root "${dev_root}" --port "${dev_port}"
      echo "nuking database..."
      run npx tsx "${dev_root}/src/scripts/db/nuke.ts"
      echo "seeding database..."
      run npm --prefix "${dev_root}" run db:seed
      server_dev start --root "${dev_root}" --port "${dev_port}"
      ;;
    status)
      echo "endpoint: ${DEV_DNS} = ${DEV_HOST}:${dev_port}"
      echo "root: ${dev_root}"
      local pid
      pid="$(find_dev_port_pid_for || true)"
      if [[ -n "${pid}" ]] && is_running_pid "${pid}"; then
        echo "${pid}" >"${pid_file}"
        echo "server dev running pid=${pid} port=${dev_port} log=${log_file}"
        return 0
      fi
      pid="$(read_dev_pid_for || true)"
      if [[ -n "${pid}" ]] && is_running_pid "${pid}"; then
        echo "server dev starting pid=${pid} port=${dev_port} log=${log_file}"
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

# Extract the Supabase project ref from a DATABASE_URL value. Format:
#   postgresql://postgres.<ref>:<password>@aws-<n>-<region>.pooler.supabase.com:6543/...
# Prints the ref to stdout, or empty string if not parseable.
extract_supabase_ref() {
  local url="$1"
  if [[ "$url" =~ postgres\.([a-z0-9]+): ]]; then
    echo "${BASH_REMATCH[1]}"
  else
    echo ""
  fi
}

# Read DATABASE_URL from an env file (`KEY=value` or `KEY="value"`).
# Trims surrounding quotes; returns empty string if file unreadable / key missing.
read_env_database_url() {
  local file="$1"
  [[ -r "$file" ]] || return 0
  local line
  line="$(grep -E '^[[:space:]]*DATABASE_URL[[:space:]]*=' "$file" | tail -n 1 || true)"
  [[ -z "$line" ]] && return 0
  # Strip leading `KEY=` and any surrounding single/double quotes.
  local value="${line#*=}"
  value="${value#\"}"; value="${value%\"}"
  value="${value#\'}"; value="${value%\'}"
  echo "$value"
}

# Audit one env-file/expected-ref pair. Echoes a single line:
#   "<label> <PASS|FAIL> <detail>"
# Returns 0 on PASS, 1 on FAIL. Caller aggregates the rc.
audit_one_env() {
  local label="$1"
  local file="$2"
  local expected_ref="$3"

  if [[ ! -r "$file" ]]; then
    echo "${label}: FAIL — env file not found or unreadable: ${file}"
    return 1
  fi

  local url
  url="$(read_env_database_url "$file")"
  if [[ -z "$url" ]]; then
    echo "${label}: FAIL — DATABASE_URL missing in ${file}"
    return 1
  fi

  local actual_ref
  actual_ref="$(extract_supabase_ref "$url")"
  if [[ -z "$actual_ref" ]]; then
    echo "${label}: FAIL — could not parse Supabase project ref from DATABASE_URL in ${file}"
    return 1
  fi

  if [[ "$actual_ref" == "$expected_ref" ]]; then
    echo "${label}: PASS — ${file} points at ${actual_ref}"
    return 0
  fi

  # Mismatched but parseable — name what's wrong + tell the operator where
  # to restore the correct credentials from.
  local hint=""
  case "$label" in
    dev) hint=" Restore from 1Password Agents/Supabase/dev info." ;;
    UAT) hint=" Restore from 1Password Agents/Supabase/UAT info." ;;
  esac

  # If the actual ref matches the *other* environment's expected ref, call
  # that out — that's the FLX-123 regression shape (dev pointing at UAT).
  local cross_hint=""
  if [[ "$label" == "dev" && "$actual_ref" == "$UAT_SUPABASE_PROJECT_REF" ]]; then
    cross_hint=" (UAT)"
  elif [[ "$label" == "UAT" && "$actual_ref" == "$DEV_SUPABASE_PROJECT_REF" ]]; then
    cross_hint=" (dev)"
  fi

  echo "${label}: FAIL — ${file} points at ${actual_ref}${cross_hint} — expected ${expected_ref}.${hint}"
  return 1
}

env_audit() {
  # Resolve dev env file. Order:
  #   1. Worktree-local .env.local (rare — `.env*` is gitignored)
  #   2. Worktree-local .env
  #   3. Main repo's .env.local (this is the canonical location — worktrees
  #      don't carry env files, so we audit the dev server's actual env)
  #   4. Main repo's .env
  # If none exist we still call audit_one_env with the preferred path so the
  # failure message names what's missing.
  local main_repo
  main_repo="$(dirname "$(git rev-parse --git-common-dir 2>/dev/null || echo "${ROOT_DIR}/.git")")"
  # If git common dir was relative (just ".git"), main_repo became "."; resolve.
  [[ "$main_repo" == "." || -z "$main_repo" ]] && main_repo="${ROOT_DIR}"

  local dev_file=""
  for candidate in \
    "$DEV_ENV_FILE_DEFAULT" \
    "$DEV_ENV_FILE_FALLBACK" \
    "${main_repo}/.env.local" \
    "${main_repo}/.env"; do
    if [[ -r "$candidate" ]]; then
      dev_file="$candidate"
      break
    fi
  done
  [[ -z "$dev_file" ]] && dev_file="$DEV_ENV_FILE_DEFAULT"

  echo "── flux env audit ─────────────────────────────────────────────"
  echo "Expected refs: dev=${DEV_SUPABASE_PROJECT_REF} UAT=${UAT_SUPABASE_PROJECT_REF}"
  echo

  local rc=0
  audit_one_env dev "$dev_file" "$DEV_SUPABASE_PROJECT_REF" || rc=1
  audit_one_env UAT "$UAT_ENV_FILE" "$UAT_SUPABASE_PROJECT_REF" || rc=1

  echo
  if [[ "$rc" -eq 0 ]]; then
    echo "✓ env audit passed — both env files point at the right Supabase projects."
  else
    echo "✗ env audit failed — see lines above. Do NOT reconstruct env files from a"
    echo "  running container's env; that's how the FLX-123 regression happened."
    echo "  Restore from 1Password and re-run \`./flux env audit\`."
  fi
  echo "───────────────────────────────────────────────────────────────"
  return "$rc"
}

env_action() {
  local action=${1:-}
  case "${action}" in
    audit) env_audit ;;
    -h|--help|help) env_usage ;;
    *) env_usage; fail "unknown env action: ${action:-<missing>}" ;;
  esac
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
        dev) server_dev "$@" ;;
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
    env)
      env_action "${1:-}"
      ;;
    *)
      usage
      fail "unknown command group: ${group}"
      ;;
  esac
}

main "$@"
