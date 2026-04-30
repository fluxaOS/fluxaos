#!/usr/bin/env bash
set -euo pipefail

STACK_DIR="${STACK_DIR:-/mnt/stacks/docker/fluxaos}"
SOURCE_DIR="${SOURCE_DIR:-${STACK_DIR}/source}"
DEPLOYED_SHA_FILE="${DEPLOYED_SHA_FILE:-${STACK_DIR}/deployed-sha}"
ROLLBACK_DIR="${ROLLBACK_DIR:-${STACK_DIR}/rollback}"
TARGET_REF="${1:-origin/main}"
IMAGE_CHANNEL="${IMAGE_CHANNEL:-internal-dev}"
ENV_FILE="${ENV_FILE:-${STACK_DIR}/fluxaos.env}"

fail() {
  echo "error: $*" >&2
  exit 1
}

require_stack_paths() {
  local canonical_stack
  local canonical_source
  local canonical_env

  canonical_stack=$(realpath -m "${STACK_DIR}")
  canonical_source=$(realpath -m "${SOURCE_DIR}")
  canonical_env=$(realpath -m "${ENV_FILE}")

  [[ "${canonical_stack}" != /mnt/dev/* ]] || fail "STACK_DIR must not be under /mnt/dev"
  [[ "${canonical_source}" != /mnt/dev/* ]] || fail "SOURCE_DIR must not resolve into a development checkout"
  [[ "${canonical_env}" != /mnt/dev/* ]] || fail "ENV_FILE must not be under /mnt/dev"

  [[ "${canonical_stack}" == /mnt/stacks/docker/fluxaos ]] || fail "STACK_DIR must be /mnt/stacks/docker/fluxaos"
  [[ "${canonical_source}" == /mnt/stacks/docker/fluxaos/source ]] || fail "SOURCE_DIR must be /mnt/stacks/docker/fluxaos/source"
  [[ "${canonical_env}" == /mnt/stacks/docker/fluxaos/fluxaos.env ]] || fail "ENV_FILE must resolve to /mnt/stacks/docker/fluxaos/fluxaos.env"

  STACK_DIR=${canonical_stack}
  SOURCE_DIR=${canonical_source}
  ENV_FILE=${canonical_env}

  [[ -d "${SOURCE_DIR}/.git" ]] || fail "SOURCE_DIR must be a git checkout"
  [[ -f "${ENV_FILE}" ]] || fail "ENV_FILE does not exist: ${ENV_FILE}"
}

env_value() {
  local key=$1
  awk -F= -v key="${key}" '$1 == key { value = substr($0, length(key) + 2) } END { print value }' "${ENV_FILE}"
}

require_runtime_preflight() {
  local redis_url
  local target_path
  local host_target
  local canonical_target
  local workspace_root
  local artifacts_root
  local daemon_grace

  docker network inspect homelab >/dev/null || fail "docker network homelab does not exist"

  docker container inspect central_redis >/dev/null 2>&1 || fail "central_redis container does not exist"
  docker inspect -f '{{if index .NetworkSettings.Networks "homelab"}}attached{{end}}' central_redis | grep -qx attached \
    || fail "central_redis is not attached to the homelab network"
  [[ "$(docker exec central_redis redis-cli ping)" == PONG ]] || fail "central_redis redis-cli ping did not return PONG"

  redis_url=$(env_value REDIS_URL)
  [[ "${redis_url}" == redis://central_redis:6379 ]] || fail "REDIS_URL must be redis://central_redis:6379"

  target_path=$(env_value FLUXAOS_TARGET_REPO_PATH)
  [[ -n "${target_path}" ]] || fail "FLUXAOS_TARGET_REPO_PATH is required"
  [[ "${target_path}" == /repos/* ]] || fail "FLUXAOS_TARGET_REPO_PATH must be under /repos"
  [[ "${target_path}" != *..* ]] || fail "FLUXAOS_TARGET_REPO_PATH must not contain .."

  host_target="${STACK_DIR}/repos/${target_path#/repos/}"
  canonical_target=$(realpath -m "${host_target}")
  [[ "${canonical_target}" == "${STACK_DIR}/repos/"* ]] || fail "target repo escaped stack repos dir"
  git -C "${host_target}" rev-parse --is-inside-work-tree >/dev/null || fail "target repo host path is not a git repo: ${host_target}"

  workspace_root=$(env_value FLUXAOS_WORKSPACE_ROOT)
  [[ "${workspace_root}" == /runtime/worktrees ]] || fail "FLUXAOS_WORKSPACE_ROOT must be /runtime/worktrees"

  artifacts_root=$(env_value FLUXAOS_ARTIFACTS_ROOT)
  [[ "${artifacts_root}" == /runtime/artifacts ]] || fail "FLUXAOS_ARTIFACTS_ROOT must be /runtime/artifacts"

  [[ -d "${STACK_DIR}/repos" && -w "${STACK_DIR}/repos" ]] || fail "runtime directory is not writable: ${STACK_DIR}/repos"
  [[ -d "${STACK_DIR}/worktrees" && -w "${STACK_DIR}/worktrees" ]] || fail "runtime directory is not writable: ${STACK_DIR}/worktrees"
  [[ -d "${STACK_DIR}/artifacts" && -w "${STACK_DIR}/artifacts" ]] || fail "runtime directory is not writable: ${STACK_DIR}/artifacts"

  daemon_grace=$(env_value FLUXAOS_DAEMON_SHUTDOWN_GRACE_SECONDS)
  [[ "${daemon_grace}" == 120 ]] || fail "FLUXAOS_DAEMON_SHUTDOWN_GRACE_SECONDS must be 120"
}

write_rollback_marker() {
  local stamp
  local marker

  mkdir -p "${ROLLBACK_DIR}"

  if [[ -f "${DEPLOYED_SHA_FILE}" ]]; then
    stamp=$(date -u +%Y%m%dT%H%M%SZ)
    marker="${ROLLBACK_DIR}/pre-update-${stamp}.sha"
    cp "${DEPLOYED_SHA_FILE}" "${marker}"
    echo "Rollback marker: ${marker}"
    echo "Rollback image command: docker tag fluxaos:$(cat "${DEPLOYED_SHA_FILE}") fluxaos:${IMAGE_CHANNEL} && docker compose up -d --force-recreate fluxaos-web fluxaos-daemon"
  else
    echo "No deployed SHA found; first deployment has no rollback marker."
  fi
}

require_stack_paths
require_runtime_preflight

cd "${SOURCE_DIR}"

if ! git diff --quiet || ! git diff --cached --quiet; then
  git status --short
  fail "source checkout is dirty"
fi

git fetch origin --prune

if [[ -f "${DEPLOYED_SHA_FILE}" ]]; then
  DEPLOYED_SHA=$(cat "${DEPLOYED_SHA_FILE}")
  echo "Changes since deployed SHA ${DEPLOYED_SHA}:"
  git log --oneline "${DEPLOYED_SHA}..${TARGET_REF}" || true
else
  echo "No deployed SHA found; this appears to be the first deployment."
fi

write_rollback_marker

git checkout "${TARGET_REF}"
TARGET_SHA=$(git rev-parse HEAD)
DEPLOY_STARTED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)
echo "Deployment started at ${DEPLOY_STARTED_AT}"

docker build --target runner -t "fluxaos:${TARGET_SHA}" -t "fluxaos:${IMAGE_CHANNEL}" "${SOURCE_DIR}"

cd "${STACK_DIR}"

FLUXAOS_IMAGE="fluxaos:${IMAGE_CHANNEL}" docker compose run --rm --no-deps fluxaos-web sh -lc 'test -d -w /repos && test -d -w /runtime/worktrees && test -d -w /runtime/artifacts'
FLUXAOS_IMAGE="fluxaos:${IMAGE_CHANNEL}" docker compose run --rm fluxaos-web npm run db:migrate:prod
FLUXAOS_IMAGE="fluxaos:${IMAGE_CHANNEL}" docker compose up -d --force-recreate fluxaos-web fluxaos-daemon
docker compose ps

EXPECTED_IMAGE_ID=$(docker image inspect -f '{{.Id}}' "fluxaos:${IMAGE_CHANNEL}")
WEB_CONTAINER_ID=$(docker compose ps -q fluxaos-web)
DAEMON_CONTAINER_ID=$(docker compose ps -q fluxaos-daemon)

[[ -n "${WEB_CONTAINER_ID}" ]] || fail "fluxaos-web container does not exist"
[[ -n "${DAEMON_CONTAINER_ID}" ]] || fail "fluxaos-daemon container does not exist"

[[ "$(docker inspect -f '{{.State.Running}}' "${WEB_CONTAINER_ID}")" == true ]] || fail "fluxaos-web is not running"
[[ "$(docker inspect -f '{{.State.Running}}' "${DAEMON_CONTAINER_ID}")" == true ]] || fail "fluxaos-daemon is not running"
[[ "$(docker inspect -f '{{.Image}}' "${WEB_CONTAINER_ID}")" == "${EXPECTED_IMAGE_ID}" ]] || fail "fluxaos-web is not using fluxaos:${IMAGE_CHANNEL}"
[[ "$(docker inspect -f '{{.Image}}' "${DAEMON_CONTAINER_ID}")" == "${EXPECTED_IMAGE_ID}" ]] || fail "fluxaos-daemon is not using fluxaos:${IMAGE_CHANNEL}"

docker compose exec -T fluxaos-web curl -fsS http://127.0.0.1:3000/api/health >/dev/null

for _ in $(seq 1 30); do
  if docker logs "${DAEMON_CONTAINER_ID}" | grep -q 'daemon.started orchestrator=running'; then
    docker logs "${DAEMON_CONTAINER_ID}" | grep 'daemon.started orchestrator=running'
    echo "${TARGET_SHA}" >"${DEPLOYED_SHA_FILE}"
    echo "Deployed ${TARGET_SHA}"
    exit 0
  fi
  sleep 2
done

fail "fluxaos-daemon did not report readiness"
