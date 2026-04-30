# FLX-100 Production Docker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first production Docker path for fluxaOS: one image that can run web and daemon, homelab Compose templates that use central Redis, and a source-build update script that rehearses the future GHCR install flow.

**Architecture:** Keep development and production separate. The production image contains Next standalone output plus a bundled Node daemon artifact, while the homelab stack templates mount `/repos`, `/runtime/worktrees`, and `/runtime/artifacts` and read one shared `fluxaos.env`. The update script builds `fluxaos:${TARGET_SHA}` and `fluxaos:internal-dev`, runs Drizzle migrations once, restarts web/daemon, and records the deployed SHA.

**Tech Stack:** Docker, Docker Compose, Next.js standalone output, Node 22 Alpine, esbuild for the daemon bundle, Drizzle migrations, Supabase Cloud, central Redis on Docker network `homelab`.

---

## Scope Notes

This plan implements the homelab production rehearsal path from the spec. It does not publish GHCR images or build the public GTM installer.

This plan adds one direct dev dependency: `esbuild`. The repo already has `esbuild` transitively through `tsx`, but production daemon bundling should not depend on a transitive package. If the operator rejects adding this direct build dependency, stop and revise the plan before implementation.

## File Structure

- Modify `package.json` and `package-lock.json` to add daemon build scripts and direct `esbuild` dev dependency.
- Create `src/scripts/db/migrate-prod.ts` as the production migration entrypoint.
- Create `scripts/build-daemon.mjs` to bundle `src/scripts/daemon.ts` into `.next/daemon/daemon.mjs` and `src/scripts/db/migrate-prod.ts` into `.next/daemon/migrate-prod.mjs`.
- Modify `Dockerfile` so the production runner can run either web (`node server.js`) or daemon (`npm run daemon:prod`) and includes the git/ssh/curl tools the daemon needs.
- Create `ops/docker/homelab/docker-compose.yml` as the checked-in homelab production Compose template.
- Create `ops/docker/homelab/fluxaos.env.example` as the checked-in env template without secrets.
- Create `ops/docker/homelab/build.sh` as the checked-in update script template intended to run from `/mnt/stacks/docker/fluxaos/build.sh`.
- Create `tests/verify/production-docker-files.ts` to mechanically verify the production Docker templates do not drift from the spec.
- Modify `package.json` to add `verify:prod-docker`.
- Modify `README.md` and `ops/README.md` to distinguish dev Compose from the production Docker rehearsal path.

## Task 1: Add Production Node Bundles

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `src/scripts/db/migrate-prod.ts`
- Create: `scripts/build-daemon.mjs`

- [ ] **Step 1: Add the direct build dependency**

Run:

```bash
npm install --save-dev esbuild
```

Expected: `package.json` gains `esbuild` in `devDependencies`, and `package-lock.json` records the exact resolved version.

- [ ] **Step 2: Add production build scripts**

Edit `package.json` so the `scripts` block includes these entries:

```json
{
  "build": "next build",
  "build:daemon": "node scripts/build-daemon.mjs",
  "build:prod": "npm run build && npm run build:daemon",
  "db:migrate:prod": "node .next/daemon/migrate-prod.mjs",
  "daemon": "tsx src/scripts/daemon.ts",
  "daemon:prod": "node .next/daemon/daemon.mjs"
}
```

Preserve the existing scripts. Only add `build:daemon`, `build:prod`, `db:migrate:prod`, and `daemon:prod`.

- [ ] **Step 3: Create the production migration entrypoint**

Create `src/scripts/db/migrate-prod.ts`:

```ts
import { join } from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';

loadDotenv({ path: join(process.cwd(), '.env'), override: false, quiet: true });
loadDotenv({
  path: join(process.cwd(), '.env.local'),
  override: false,
  quiet: true,
});

const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;

if (!url) {
  throw new Error(
    'DIRECT_URL or DATABASE_URL is required for migrations. ' +
      'Set DIRECT_URL to your Supabase direct connection (port 5432).'
  );
}

const client = postgres(url, { max: 1 });
const db = drizzle(client);

try {
  await migrate(db, { migrationsFolder: './drizzle' });
  console.log('migrations applied');
} finally {
  await client.end();
}
```

- [ ] **Step 4: Create the production bundle builder**

Create `scripts/build-daemon.mjs`:

```js
import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const root = resolve(__dirname, '..');
const outdir = resolve(root, '.next/daemon');

const aliasPlugin = {
  name: 'fluxaos-path-alias',
  setup(build) {
    build.onResolve({ filter: /^@\// }, (args) => ({
      path: resolve(root, 'src', args.path.slice(2)),
    }));
  },
};

await mkdir(outdir, { recursive: true });

await build({
  entryPoints: {
    daemon: resolve(root, 'src/scripts/daemon.ts'),
    'migrate-prod': resolve(root, 'src/scripts/db/migrate-prod.ts'),
  },
  outdir,
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  packages: 'external',
  sourcemap: true,
  plugins: [aliasPlugin],
  logLevel: 'info',
});
```

- [ ] **Step 5: Verify production bundles build**

Run:

```bash
npm run build:daemon
test -f .next/daemon/daemon.mjs
test -f .next/daemon/migrate-prod.mjs
```

Expected: `npm run build:daemon` exits 0 and both bundle files exist.

- [ ] **Step 6: Verify production entrypoints fail fast without env**

Run:

```bash
env -i PATH="$PATH" HOME="$HOME" NODE_ENV=production npm run daemon:prod
env -i PATH="$PATH" HOME="$HOME" NODE_ENV=production npm run db:migrate:prod
```

Expected: daemon command exits non-zero and logs `Missing required environment variable: FLUXAOS_DAEMON_SHUTDOWN_GRACE_SECONDS`. Migration command exits non-zero and logs `DIRECT_URL or DATABASE_URL is required for migrations`.

- [ ] **Step 7: Commit Task 1**

Run:

```bash
git add package.json package-lock.json src/scripts/db/migrate-prod.ts scripts/build-daemon.mjs
git commit -m "build: bundle production Node entrypoints" -m "Refs FLX-100"
```

## Task 2: Build One Production Image For Web And Daemon

**Files:**
- Modify: `Dockerfile`

- [ ] **Step 1: Replace the Dockerfile**

Replace `Dockerfile` with:

```Dockerfile
FROM node:22-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci

FROM deps AS dev
COPY . .
CMD ["npm", "run", "dev"]

FROM deps AS builder
COPY . .
RUN npm run build:prod

FROM deps AS prod-deps
RUN npm prune --omit=dev

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

RUN apk add --no-cache bash curl git openssh-client
RUN npm install -g @anthropic-ai/claude-code@2.1.123

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/.next/daemon ./.next/daemon
COPY --from=builder /app/public ./public
COPY --from=builder /app/drizzle ./drizzle
COPY --from=builder /app/package.json ./package.json

CMD ["node", "server.js"]
```

The global `@anthropic-ai/claude-code` install is intentional for the alpha image because the seeded driver executes the `claude` binary. The exact version `2.1.123` was verified with `npm view @anthropic-ai/claude-code version` on 2026-04-30. Re-check before implementation if this plan is executed on a later date.

- [ ] **Step 2: Build the production image locally**

Run:

```bash
docker build --target runner -t fluxaos:plan-check .
```

Expected: image builds successfully.

- [ ] **Step 3: Verify the image contains both entrypoints**

Run:

```bash
docker run --rm fluxaos:plan-check node -e "require('fs').accessSync('server.js'); require('fs').accessSync('.next/daemon/daemon.mjs'); console.log('ok')"
docker run --rm fluxaos:plan-check node -e "require('fs').accessSync('.next/daemon/migrate-prod.mjs'); require('fs').accessSync('drizzle'); console.log('ok')"
docker run --rm fluxaos:plan-check claude --version
```

Expected: first two commands print `ok`; third command exits 0 and prints the Claude Code version.

- [ ] **Step 4: Verify production entrypoint fast-fail inside the image**

Run:

```bash
docker run --rm fluxaos:plan-check npm run daemon:prod
docker run --rm fluxaos:plan-check npm run db:migrate:prod
```

Expected: daemon command exits non-zero and logs `Missing required environment variable: FLUXAOS_DAEMON_SHUTDOWN_GRACE_SECONDS`. Migration command exits non-zero and logs `DIRECT_URL or DATABASE_URL is required for migrations`.

- [ ] **Step 5: Commit Task 2**

Run:

```bash
git add Dockerfile
git commit -m "build: create production runtime image" -m "Refs FLX-100"
```

## Task 3: Add Homelab Production Compose Templates

**Files:**
- Create: `ops/docker/homelab/docker-compose.yml`
- Create: `ops/docker/homelab/fluxaos.env.example`

- [ ] **Step 1: Create the homelab compose template**

Create `ops/docker/homelab/docker-compose.yml`:

```yaml
services:
  fluxaos-web:
    image: ${FLUXAOS_IMAGE:-fluxaos:internal-dev}
    container_name: fluxaos-web
    restart: unless-stopped
    env_file:
      - ./fluxaos.env
    environment:
      NODE_ENV: production
      PORT: "3000"
    ports:
      - "${FLUXAOS_WEB_PORT:-3003}:3000"
    volumes:
      - /mnt/stacks/docker/fluxaos/repos:/repos
      - /mnt/stacks/docker/fluxaos/worktrees:/runtime/worktrees
      - /mnt/stacks/docker/fluxaos/artifacts:/runtime/artifacts
    networks:
      - homelab
    healthcheck:
      test: ["CMD-SHELL", "curl -fsS http://127.0.0.1:3000/api/health >/dev/null"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 30s

  fluxaos-daemon:
    image: ${FLUXAOS_IMAGE:-fluxaos:internal-dev}
    container_name: fluxaos-daemon
    restart: unless-stopped
    command: ["npm", "run", "daemon:prod"]
    env_file:
      - ./fluxaos.env
    environment:
      NODE_ENV: production
    stop_grace_period: 120s
    volumes:
      - /mnt/stacks/docker/fluxaos/repos:/repos
      - /mnt/stacks/docker/fluxaos/worktrees:/runtime/worktrees
      - /mnt/stacks/docker/fluxaos/artifacts:/runtime/artifacts
    networks:
      - homelab

networks:
  homelab:
    external: true
```

- [ ] **Step 2: Create the env example**

Create `ops/docker/homelab/fluxaos.env.example`:

```dotenv
# Copy to /mnt/stacks/docker/fluxaos/fluxaos.env and replace sample values with real values.

FLUXAOS_IMAGE=fluxaos:internal-dev
FLUXAOS_WEB_PORT=3003

DATABASE_URL=postgresql://user:password@host:6543/postgres
DIRECT_URL=postgresql://user:password@host:5432/postgres
NEXT_PUBLIC_SUPABASE_URL=https://example.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=replace-me
SUPABASE_SERVICE_ROLE_KEY=replace-me

ANTHROPIC_API_KEY=replace-me
FLUXAOS_GITHUB_TOKEN=replace-me
REDIS_URL=redis://central_redis:6379

FLUXAOS_TARGET_REPO_PATH=/repos/fluxaOS/fluxaos
FLUXAOS_WORKSPACE_ROOT=/runtime/worktrees
FLUXAOS_ARTIFACTS_ROOT=/runtime/artifacts

FLUXAOS_DAEMON_SHUTDOWN_GRACE_SECONDS=120
FLUXAOS_CLEANUP_SWEEP_INTERVAL_MIN=15
FLUXAOS_CLEANUP_STALE_DAYS=7
FLUXAOS_CLEANUP_SESSION_RETENTION_DAYS=14
FLUXAOS_CLEANUP_ARTIFACTS_RETENTION_DAYS=14
# FLUXAOS_DAEMON_RECOVERY_SWEEP_INTERVAL_MIN=15
```

- [ ] **Step 3: Verify compose syntax**

Run:

```bash
cp ops/docker/homelab/fluxaos.env.example ops/docker/homelab/fluxaos.env
trap 'rm -f ops/docker/homelab/fluxaos.env' EXIT
docker compose -f ops/docker/homelab/docker-compose.yml --env-file ops/docker/homelab/fluxaos.env config >/tmp/fluxaos-compose.yml
rm -f ops/docker/homelab/fluxaos.env
trap - EXIT
```

Expected: `docker compose config` exits 0 and `/tmp/fluxaos-compose.yml` contains both `fluxaos-web` and `fluxaos-daemon`.

- [ ] **Step 4: Commit Task 3**

Run:

```bash
git add ops/docker/homelab/docker-compose.yml ops/docker/homelab/fluxaos.env.example
git commit -m "ops: add homelab production compose template" -m "Refs FLX-100"
```

## Task 4: Add Source-Build Update Script

**Files:**
- Create: `ops/docker/homelab/build.sh`

- [ ] **Step 1: Create the update script template**

Create `ops/docker/homelab/build.sh`:

```bash
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
  local canonical_stack canonical_source canonical_env
  canonical_stack="$(realpath -m "${STACK_DIR}")"
  canonical_source="$(realpath -m "${SOURCE_DIR}")"
  canonical_env="$(realpath -m "${ENV_FILE}")"

  case "${canonical_stack}" in
    /mnt/stacks/docker/fluxaos) ;;
    /mnt/dev/*) fail "STACK_DIR must not resolve into /mnt/dev: ${canonical_stack}" ;;
    *) fail "STACK_DIR must resolve to /mnt/stacks/docker/fluxaos, got ${canonical_stack}" ;;
  esac

  case "${canonical_source}" in
    /mnt/stacks/docker/fluxaos/source) ;;
    /mnt/dev/*) fail "SOURCE_DIR must not resolve into a development checkout: ${canonical_source}" ;;
    *) fail "SOURCE_DIR must resolve to /mnt/stacks/docker/fluxaos/source, got ${canonical_source}" ;;
  esac

  case "${canonical_env}" in
    /mnt/stacks/docker/fluxaos/fluxaos.env) ;;
    /mnt/dev/*) fail "ENV_FILE must not resolve into /mnt/dev: ${canonical_env}" ;;
    *) fail "ENV_FILE must resolve to /mnt/stacks/docker/fluxaos/fluxaos.env, got ${canonical_env}" ;;
  esac

  [ -d "${SOURCE_DIR}/.git" ] || fail "SOURCE_DIR is not a git checkout: ${SOURCE_DIR}"
  [ -f "${ENV_FILE}" ] || fail "missing env file: ${ENV_FILE}"
}

env_value() {
  local key="$1"
  awk -F= -v key="${key}" '$1 == key { value = substr($0, length(key) + 2) } END { print value }' "${ENV_FILE}"
}

require_runtime_preflight() {
  docker network inspect homelab >/dev/null || fail "Docker network 'homelab' is missing"
  docker inspect central_redis >/dev/null || fail "central_redis container is missing"
  docker inspect central_redis --format '{{json .NetworkSettings.Networks}}' | grep -q '"homelab"' ||
    fail "central_redis is not attached to the homelab network"
  docker exec central_redis redis-cli ping | grep -qx PONG || fail "central_redis did not return PONG"

  local redis_url
  redis_url="$(env_value REDIS_URL)"
  [ "${redis_url}" = "redis://central_redis:6379" ] ||
    fail "REDIS_URL must be redis://central_redis:6379 for the homelab profile"

  local target_path
  target_path="$(env_value FLUXAOS_TARGET_REPO_PATH)"
  [ -n "${target_path}" ] || fail "FLUXAOS_TARGET_REPO_PATH is missing from ${ENV_FILE}"

  case "${target_path}" in
    /repos/*) ;;
    *) fail "FLUXAOS_TARGET_REPO_PATH must be a container path under /repos, got ${target_path}" ;;
  esac
  case "${target_path}" in
    *..*) fail "FLUXAOS_TARGET_REPO_PATH must not contain '..': ${target_path}" ;;
  esac

  local host_target="${STACK_DIR}/repos/${target_path#/repos/}"
  local canonical_target
  canonical_target="$(realpath -m "${host_target}")"
  case "${canonical_target}" in
    "${STACK_DIR}/repos"/*) ;;
    *) fail "target repo escaped stack repos dir: ${canonical_target}" ;;
  esac
  git -C "${host_target}" rev-parse --is-inside-work-tree >/dev/null ||
    fail "target repo host path is not a git repo: ${host_target}"

  [ "$(env_value FLUXAOS_WORKSPACE_ROOT)" = "/runtime/worktrees" ] ||
    fail "FLUXAOS_WORKSPACE_ROOT must be /runtime/worktrees"
  [ "$(env_value FLUXAOS_ARTIFACTS_ROOT)" = "/runtime/artifacts" ] ||
    fail "FLUXAOS_ARTIFACTS_ROOT must be /runtime/artifacts"

  for dir in "${STACK_DIR}/repos" "${STACK_DIR}/worktrees" "${STACK_DIR}/artifacts"; do
    [ -d "${dir}" ] || fail "runtime directory is missing: ${dir}"
    [ -w "${dir}" ] || fail "runtime directory is not writable: ${dir}"
  done

  local daemon_grace
  daemon_grace="$(env_value FLUXAOS_DAEMON_SHUTDOWN_GRACE_SECONDS)"
  [ "${daemon_grace}" = "120" ] ||
    fail "FLUXAOS_DAEMON_SHUTDOWN_GRACE_SECONDS must be 120 to match compose stop_grace_period"
}

write_rollback_marker() {
  mkdir -p "${ROLLBACK_DIR}"
  if [ -f "${DEPLOYED_SHA_FILE}" ]; then
    local stamp
    stamp="$(date -u +%Y%m%dT%H%M%SZ)"
    cp "${DEPLOYED_SHA_FILE}" "${ROLLBACK_DIR}/pre-update-${stamp}.sha"
    echo "Rollback marker: ${ROLLBACK_DIR}/pre-update-${stamp}.sha"
    echo "Rollback image command: FLUXAOS_IMAGE=fluxaos:$(cat "${DEPLOYED_SHA_FILE}") docker compose up -d fluxaos-web fluxaos-daemon"
  else
    echo "No deployed-sha file found; this looks like the first deployment."
  fi
}

require_stack_paths
require_runtime_preflight

cd "${SOURCE_DIR}"

if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "production source checkout is dirty; aborting" >&2
  git status --short >&2
  exit 1
fi

git fetch origin --prune

if [ -f "${DEPLOYED_SHA_FILE}" ]; then
  DEPLOYED_SHA="$(cat "${DEPLOYED_SHA_FILE}")"
  echo "Changes since deployed SHA ${DEPLOYED_SHA}:"
  git log --oneline "${DEPLOYED_SHA}..${TARGET_REF}" || true
else
  echo "No deployed-sha file found; this looks like the first deployment."
fi

write_rollback_marker

git checkout "${TARGET_REF}"
TARGET_SHA="$(git rev-parse HEAD)"
DEPLOY_STARTED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

echo "Building fluxaOS image for ${TARGET_SHA}"
docker build --target runner \
  -t "fluxaos:${TARGET_SHA}" \
  -t "fluxaos:${IMAGE_CHANNEL}" \
  "${SOURCE_DIR}"

cd "${STACK_DIR}"

echo "Checking runtime mounts in one-shot container"
FLUXAOS_IMAGE="fluxaos:${IMAGE_CHANNEL}" docker compose run --rm --no-deps fluxaos-web sh -lc \
  'test -d -w /repos && test -d -w /runtime/worktrees && test -d -w /runtime/artifacts'

echo "Running Drizzle migrations"
FLUXAOS_IMAGE="fluxaos:${IMAGE_CHANNEL}" docker compose run --rm fluxaos-web npm run db:migrate:prod

echo "Restarting fluxaOS services"
FLUXAOS_IMAGE="fluxaos:${IMAGE_CHANNEL}" docker compose up -d --force-recreate fluxaos-web fluxaos-daemon

echo "Container status"
docker compose ps

EXPECTED_IMAGE_ID="$(docker image inspect -f '{{.Id}}' "fluxaos:${IMAGE_CHANNEL}")"
WEB_CONTAINER_ID="$(docker compose ps -q fluxaos-web)"
DAEMON_CONTAINER_ID="$(docker compose ps -q fluxaos-daemon)"
[ -n "${WEB_CONTAINER_ID}" ] || fail "fluxaos-web container is missing after restart"
[ -n "${DAEMON_CONTAINER_ID}" ] || fail "fluxaos-daemon container is missing after restart"
[ "$(docker inspect -f '{{.Image}}' "${WEB_CONTAINER_ID}")" = "${EXPECTED_IMAGE_ID}" ] ||
  fail "fluxaos-web is not running the freshly built image"
[ "$(docker inspect -f '{{.Image}}' "${DAEMON_CONTAINER_ID}")" = "${EXPECTED_IMAGE_ID}" ] ||
  fail "fluxaos-daemon is not running the freshly built image"
[ "$(docker inspect -f '{{.State.Running}}' "${WEB_CONTAINER_ID}")" = "true" ] ||
  fail "fluxaos-web is not running"
[ "$(docker inspect -f '{{.State.Running}}' "${DAEMON_CONTAINER_ID}")" = "true" ] ||
  fail "fluxaos-daemon is not running"

echo "Checking web health"
docker compose exec -T fluxaos-web curl -fsS http://127.0.0.1:3000/api/health >/dev/null

echo "Checking daemon readiness log"
for _ in $(seq 1 30); do
  if docker logs "${DAEMON_CONTAINER_ID}" | grep -q 'daemon.started orchestrator=running'; then
    break
  fi
  sleep 2
done
docker logs "${DAEMON_CONTAINER_ID}" | grep 'daemon.started orchestrator=running'

printf '%s\n' "${TARGET_SHA}" > "${DEPLOYED_SHA_FILE}"
echo "Deployed ${TARGET_SHA}"
```

- [ ] **Step 2: Make the script executable**

Run:

```bash
chmod +x ops/docker/homelab/build.sh
```

Expected: `test -x ops/docker/homelab/build.sh` exits 0.

- [ ] **Step 3: Verify shell syntax**

Run:

```bash
bash -n ops/docker/homelab/build.sh
```

Expected: command exits 0.

- [ ] **Step 4: Commit Task 4**

Run:

```bash
git add ops/docker/homelab/build.sh
git commit -m "ops: add homelab production update script" -m "Refs FLX-100"
```

## Task 5: Add Drift Verification For Production Docker Files

**Files:**
- Create: `tests/verify/production-docker-files.ts`
- Modify: `package.json`

- [ ] **Step 1: Create the verification script**

Create `tests/verify/production-docker-files.ts`:

```ts
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const root = process.cwd();

function read(path: string): string {
  return readFileSync(join(root, path), 'utf8');
}

function assertIncludes(file: string, content: string, expected: string): void {
  if (!content.includes(expected)) {
    throw new Error(`${file} is missing expected content: ${expected}`);
  }
}

function assertExcludes(file: string, content: string, forbidden: string): void {
  if (content.includes(forbidden)) {
    throw new Error(`${file} contains forbidden content: ${forbidden}`);
  }
}

const dockerfile = read('Dockerfile');
assertIncludes('Dockerfile', dockerfile, 'RUN npm run build:prod');
assertIncludes('Dockerfile', dockerfile, 'COPY --from=builder /app/.next/daemon ./.next/daemon');
assertIncludes('Dockerfile', dockerfile, 'RUN apk add --no-cache bash curl git openssh-client');
assertIncludes('Dockerfile', dockerfile, 'RUN npm install -g @anthropic-ai/claude-code@');
assertExcludes('Dockerfile', dockerfile, 'drizzle.config.ts');

const compose = read('ops/docker/homelab/docker-compose.yml');
assertIncludes('ops/docker/homelab/docker-compose.yml', compose, 'fluxaos-web:');
assertIncludes('ops/docker/homelab/docker-compose.yml', compose, 'fluxaos-daemon:');
assertIncludes('ops/docker/homelab/docker-compose.yml', compose, 'external: true');
assertIncludes('ops/docker/homelab/docker-compose.yml', compose, '/mnt/stacks/docker/fluxaos/repos:/repos');
assertIncludes('ops/docker/homelab/docker-compose.yml', compose, '/mnt/stacks/docker/fluxaos/worktrees:/runtime/worktrees');
assertIncludes('ops/docker/homelab/docker-compose.yml', compose, '/mnt/stacks/docker/fluxaos/artifacts:/runtime/artifacts');
assertIncludes('ops/docker/homelab/docker-compose.yml', compose, 'stop_grace_period: 120s');
assertExcludes('ops/docker/homelab/docker-compose.yml', compose, 'depends_on:');
assertExcludes('ops/docker/homelab/docker-compose.yml', compose, 'redis:7');

const env = read('ops/docker/homelab/fluxaos.env.example');
assertIncludes('ops/docker/homelab/fluxaos.env.example', env, 'REDIS_URL=redis://central_redis:6379');
assertIncludes('ops/docker/homelab/fluxaos.env.example', env, 'FLUXAOS_TARGET_REPO_PATH=/repos/fluxaOS/fluxaos');
assertIncludes('ops/docker/homelab/fluxaos.env.example', env, 'FLUXAOS_WORKSPACE_ROOT=/runtime/worktrees');
assertIncludes('ops/docker/homelab/fluxaos.env.example', env, 'FLUXAOS_ARTIFACTS_ROOT=/runtime/artifacts');

const buildScript = read('ops/docker/homelab/build.sh');
assertIncludes('ops/docker/homelab/build.sh', buildScript, 'STACK_DIR="${STACK_DIR:-/mnt/stacks/docker/fluxaos}"');
assertIncludes('ops/docker/homelab/build.sh', buildScript, 'realpath -m "${STACK_DIR}"');
assertIncludes('ops/docker/homelab/build.sh', buildScript, 'SOURCE_DIR must not resolve into a development checkout');
assertIncludes('ops/docker/homelab/build.sh', buildScript, 'ENV_FILE must resolve to /mnt/stacks/docker/fluxaos/fluxaos.env');
assertIncludes('ops/docker/homelab/build.sh', buildScript, 'docker network inspect homelab');
assertIncludes('ops/docker/homelab/build.sh', buildScript, 'central_redis is not attached to the homelab network');
assertIncludes('ops/docker/homelab/build.sh', buildScript, 'docker exec central_redis redis-cli ping');
assertIncludes('ops/docker/homelab/build.sh', buildScript, 'REDIS_URL must be redis://central_redis:6379');
assertIncludes('ops/docker/homelab/build.sh', buildScript, 'FLUXAOS_TARGET_REPO_PATH must not contain');
assertIncludes('ops/docker/homelab/build.sh', buildScript, 'target repo escaped stack repos dir');
assertIncludes('ops/docker/homelab/build.sh', buildScript, 'FLUXAOS_WORKSPACE_ROOT must be /runtime/worktrees');
assertIncludes('ops/docker/homelab/build.sh', buildScript, 'FLUXAOS_ARTIFACTS_ROOT must be /runtime/artifacts');
assertIncludes('ops/docker/homelab/build.sh', buildScript, 'runtime directory is not writable');
assertIncludes('ops/docker/homelab/build.sh', buildScript, 'FLUXAOS_DAEMON_SHUTDOWN_GRACE_SECONDS must be 120');
assertIncludes('ops/docker/homelab/build.sh', buildScript, 'Rollback marker:');
assertIncludes('ops/docker/homelab/build.sh', buildScript, '--force-recreate');
assertIncludes('ops/docker/homelab/build.sh', buildScript, 'docker compose run --rm --no-deps fluxaos-web sh -lc');
assertIncludes('ops/docker/homelab/build.sh', buildScript, 'docker logs "${DAEMON_CONTAINER_ID}"');
assertIncludes('ops/docker/homelab/build.sh', buildScript, '-t "fluxaos:${TARGET_SHA}"');
assertIncludes('ops/docker/homelab/build.sh', buildScript, '-t "fluxaos:${IMAGE_CHANNEL}"');
assertIncludes('ops/docker/homelab/build.sh', buildScript, 'docker compose run --rm fluxaos-web npm run db:migrate:prod');

execFileSync('cp', [
  'ops/docker/homelab/fluxaos.env.example',
  'ops/docker/homelab/fluxaos.env',
]);
try {
const normalizedCompose = execFileSync(
  'docker',
  [
    'compose',
    '-f',
    'ops/docker/homelab/docker-compose.yml',
    '--env-file',
    'ops/docker/homelab/fluxaos.env.example',
    'config',
  ],
  { encoding: 'utf8' }
);
  const requiredEnv = [
    'DATABASE_URL:',
    'DIRECT_URL:',
    'NEXT_PUBLIC_SUPABASE_URL:',
    'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:',
    'SUPABASE_SERVICE_ROLE_KEY:',
    'ANTHROPIC_API_KEY:',
    'FLUXAOS_GITHUB_TOKEN:',
    'REDIS_URL:',
    'FLUXAOS_TARGET_REPO_PATH:',
    'FLUXAOS_WORKSPACE_ROOT:',
    'FLUXAOS_ARTIFACTS_ROOT:',
    'FLUXAOS_DAEMON_SHUTDOWN_GRACE_SECONDS:',
    'FLUXAOS_CLEANUP_SWEEP_INTERVAL_MIN:',
    'FLUXAOS_CLEANUP_STALE_DAYS:',
    'FLUXAOS_CLEANUP_SESSION_RETENTION_DAYS:',
    'FLUXAOS_CLEANUP_ARTIFACTS_RETENTION_DAYS:',
  ];

  function serviceBlock(serviceName: string): string {
    const marker = `  ${serviceName}:\n`;
    const start = normalizedCompose.indexOf(marker);
    if (start === -1) {
      throw new Error(`docker compose config missing service ${serviceName}`);
    }
    const rest = normalizedCompose.slice(start + marker.length);
    const nextService = rest.search(/\n  [a-zA-Z0-9_-]+:\n/);
    return nextService === -1 ? rest : rest.slice(0, nextService);
  }

  for (const service of ['fluxaos-web', 'fluxaos-daemon']) {
    const block = serviceBlock(service);
    for (const key of requiredEnv) {
      assertIncludes(`docker compose config service ${service}`, block, key);
    }
  }
} finally {
  execFileSync('rm', ['-f', 'ops/docker/homelab/fluxaos.env']);
}

console.log('production Docker files verified');
```

- [ ] **Step 2: Add the npm script**

Add this script to `package.json`:

```json
{
  "verify:prod-docker": "tsx tests/verify/production-docker-files.ts"
}
```

Preserve existing scripts.

- [ ] **Step 3: Verify the new check**

Run:

```bash
npm run verify:prod-docker
```

Expected: prints `production Docker files verified`.

- [ ] **Step 4: Commit Task 5**

Run:

```bash
git add package.json tests/verify/production-docker-files.ts
git commit -m "test: verify production Docker templates" -m "Refs FLX-100"
```

## Task 6: Document Production Docker Operations

**Files:**
- Modify: `README.md`
- Modify: `ops/README.md`

- [ ] **Step 1: Update README Docker guidance**

In `README.md`, add a `Production Docker` subsection after the Quick Start section:

```markdown
## Production Docker

The checked-in `docker-compose.yml` is a development convenience. Production Docker uses the homelab template in `ops/docker/homelab/`.

The first production profile is a homelab rehearsal for the future public install path:

- web and daemon run as separate services from the same image
- Supabase Cloud remains the database/auth/realtime provider
- Redis is the shared `central_redis` service on the external `homelab` Docker network
- runtime data lives under `/mnt/stacks/docker/fluxaos/`
- deploys run through `/mnt/stacks/docker/fluxaos/build.sh`

See `ops/README.md` for the operator runbook.
```

- [ ] **Step 2: Update ops runbook**

In `ops/README.md`, add a `Production Docker rehearsal` section before `Orchestrator daemon`:

````markdown
## Production Docker rehearsal

The production Docker rehearsal runs from `/mnt/stacks/docker/fluxaos/`, not from the development checkout.

The fluxaOS web and daemon containers intentionally run as root. This is an explicit exception to the usual homelab `user: "1026:100"` convention because the daemon writes git worktrees, artifacts, and stack-owned target clones on NFS-backed storage. Keep writable mounts scoped to `/mnt/stacks/docker/fluxaos/`.

Expected stack layout:

```text
/mnt/stacks/docker/fluxaos/
  docker-compose.yml
  fluxaos.env
  build.sh
  deployed-sha
  source/
  repos/
  worktrees/
  artifacts/
```

Bootstrap the stack files from the checked-in templates:

```bash
mkdir -p /mnt/stacks/docker/fluxaos/{source,repos,worktrees,artifacts}
cp ops/docker/homelab/docker-compose.yml /mnt/stacks/docker/fluxaos/docker-compose.yml
cp ops/docker/homelab/fluxaos.env.example /mnt/stacks/docker/fluxaos/fluxaos.env
cp ops/docker/homelab/build.sh /mnt/stacks/docker/fluxaos/build.sh
chmod +x /mnt/stacks/docker/fluxaos/build.sh
```

Fill `/mnt/stacks/docker/fluxaos/fluxaos.env` with real Supabase, AI provider, GitHub, Redis, daemon, and cleanup values.

Clone production source and target repos:

```bash
git clone https://github.com/fluxaOS/fluxaos.git /mnt/stacks/docker/fluxaos/source
mkdir -p /mnt/stacks/docker/fluxaos/repos/fluxaOS
git clone https://github.com/fluxaOS/fluxaos.git /mnt/stacks/docker/fluxaos/repos/fluxaOS/fluxaos
```

Deploy or update:

```bash
/mnt/stacks/docker/fluxaos/build.sh
```

Routine restarts do not run migrations:

```bash
cd /mnt/stacks/docker/fluxaos
docker compose up -d fluxaos-web fluxaos-daemon
```

Backup expectations for this profile:

- Supabase Cloud owns database/auth/realtime backups.
- Back up `/mnt/stacks/docker/fluxaos/fluxaos.env`.
- Back up `/mnt/stacks/docker/fluxaos/repos`.
- Back up `/mnt/stacks/docker/fluxaos/artifacts`.
- Back up `/mnt/stacks/docker/fluxaos/deployed-sha` and `/mnt/stacks/docker/fluxaos/rollback`.
- `/mnt/stacks/docker/fluxaos/worktrees` is runtime working state and may be cleaned by policy.

Restore expectations:

- The rollback marker only restores the image/version by pointing `FLUXAOS_IMAGE` back at the previous SHA and restarting `fluxaos-web` and `fluxaos-daemon`.
- The rollback marker does not undo database migrations.
- Before running an update that includes migrations, confirm Supabase Cloud backup/PITR is available for the project.
- If a migration must be rolled back, restore through Supabase Cloud first, then restart the previous image from the rollback marker.
````

Keep the existing systemd daemon section because local/dev operators may still use it.

- [ ] **Step 3: Commit Task 6**

Run:

```bash
git add README.md ops/README.md
git commit -m "docs: document production Docker rehearsal" -m "Refs FLX-100"
```

## Task 7: Full Verification

**Files:**
- No new files.

- [ ] **Step 1: Run static checks**

Run:

```bash
npx tsc --noEmit
npm run lint
npm run verify:prod-docker
bash -n ops/docker/homelab/build.sh
cp ops/docker/homelab/fluxaos.env.example ops/docker/homelab/fluxaos.env
docker compose -f ops/docker/homelab/docker-compose.yml --env-file ops/docker/homelab/fluxaos.env config >/tmp/fluxaos-compose.yml
rm -f ops/docker/homelab/fluxaos.env
```

Expected: all commands exit 0.

- [ ] **Step 2: Run build checks**

Run:

```bash
npm run build:prod
docker build --target runner -t fluxaos:flx-100-verify .
```

Expected: both commands exit 0.

- [ ] **Step 3: Run runtime smoke checks**

Run:

```bash
docker run --rm fluxaos:flx-100-verify node -e "require('fs').accessSync('server.js'); require('fs').accessSync('.next/daemon/daemon.mjs'); console.log('ok')"
docker run --rm fluxaos:flx-100-verify node -e "require('fs').accessSync('.next/daemon/migrate-prod.mjs'); require('fs').accessSync('drizzle'); console.log('ok')"
docker run --rm fluxaos:flx-100-verify claude --version
docker run --rm fluxaos:flx-100-verify npm run daemon:prod
docker run --rm fluxaos:flx-100-verify npm run db:migrate:prod
```

Expected:

- first two commands print `ok`
- third command exits 0 and prints the Claude Code version
- fourth command exits non-zero with `Missing required environment variable: FLUXAOS_DAEMON_SHUTDOWN_GRACE_SECONDS`
- fifth command exits non-zero with `DIRECT_URL or DATABASE_URL is required for migrations`

- [ ] **Step 4: Run homelab production rehearsal smoke when stack env exists**

Run:

```bash
if [ -f /mnt/stacks/docker/fluxaos/fluxaos.env ] && [ -d /mnt/stacks/docker/fluxaos/source/.git ]; then
  CURRENT_SHA="$(git rev-parse HEAD)"
  cp ops/docker/homelab/docker-compose.yml /mnt/stacks/docker/fluxaos/docker-compose.yml
  cp ops/docker/homelab/build.sh /mnt/stacks/docker/fluxaos/build.sh
  chmod +x /mnt/stacks/docker/fluxaos/build.sh
  git -C /mnt/stacks/docker/fluxaos/source fetch /mnt/dev/fluxaos HEAD
  git -C /mnt/stacks/docker/fluxaos/source checkout "${CURRENT_SHA}"
  /mnt/stacks/docker/fluxaos/build.sh "${CURRENT_SHA}"
  cd /mnt/stacks/docker/fluxaos
  docker compose exec -T fluxaos-web curl -fsS http://127.0.0.1:3000/api/health
  STARTED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  docker compose stop fluxaos-daemon
  docker compose logs --since "${STARTED_AT}" fluxaos-daemon | grep 'daemon.drain_completed'
  docker compose up -d fluxaos-daemon
else
  echo "homelab production stack not bootstrapped; skip rehearsal smoke"
fi
```

Expected when the stack is bootstrapped: checked-in templates are copied into the stack, production source is updated to the current implementation SHA, `build.sh "${CURRENT_SHA}"` exits 0, `/api/health` returns JSON with `"status":"healthy"`, daemon stop logs include `daemon.drain_completed`, and daemon restarts. Expected when the stack is not bootstrapped: the command prints `homelab production stack not bootstrapped; skip rehearsal smoke`; do not claim production rehearsal was verified in that case.

- [ ] **Step 5: Commit verification fixes if needed**

If verification required fixes, commit them:

```bash
git status --short
git add Dockerfile package.json package-lock.json scripts/build-daemon.mjs ops/docker/homelab tests/verify/production-docker-files.ts README.md ops/README.md
git commit -m "fix: stabilize production Docker verification" -m "Refs FLX-100"
```

If no fixes were needed, do not create an empty commit.

## Plan Self-Review

Spec coverage:

- Production Docker topology: Tasks 2 and 3.
- Web + daemon together: Tasks 2 and 3.
- Central Redis on homelab: Tasks 3 and 5.
- Root container exception: Task 3 omits `user:` and docs in Task 6 explain the stack behavior from the spec.
- Stack-owned source/target/worktree/artifact layout: Tasks 3, 4, and 6.
- `fluxaos.env`: Task 3 and Task 6.
- Supabase Cloud only: Task 3 env and Task 6 docs.
- Explicit update script: Task 4, including hard guards against `/mnt/dev/...` production deploys.
- Drizzle migrations as one-shot deploy step: Task 1 creates the production migration bundle and Task 4 invokes it.
- Health/logs/shutdown: Tasks 3, 4, 5, 6, and 7, including existing `/api/health`, existing daemon sentinel, Redis network preflight, target repo preflight, runtime path preflight, fresh-container validation, and fixed stop grace alignment.
- Rollback marker: Task 4 writes timestamped pre-update rollback markers before checkout/build/restart mutation.
- Backup and restore expectations: Task 6 docs.
- Future GHCR-compatible image channel: Tasks 3 and 4.

Placeholder scan: no red-flag placeholder tokens remain. Commands use concrete paths and names.

Type consistency: scripts use `build:prod`, `build:daemon`, and `daemon:prod` consistently. Compose uses `fluxaos-web` and `fluxaos-daemon` consistently. Runtime paths match the approved spec.
