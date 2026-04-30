# FLX-100 Production Docker — Repair and Complete

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the FLX-100 production Docker instance by closing three spec gaps (SSH Git auth, authenticated Redis, Playwright root-redirect coverage) and running a real `build.sh` deployment that produces a working instance at `http://192.168.54.101:3003`.

**Architecture:** Tasks 1–3 close the spec gaps and are committed + pushed before any rehearsal runs. Task 4a builds the env file and runs preflights. Task 4b runs `build.sh` and confirms the instance is live. Task 4c updates the PR and Linear. The Playwright spec (Task 3) must be in the push range so Gate 3 passes cleanly without `FLUXAOS_SKIP_PREPUSH_GATE`.

**Tech Stack:** Docker Compose, Bash, TypeScript (Playwright), `ops/docker/homelab/docker-compose.yml`, `ops/docker/homelab/fluxaos.env.example`, `ops/README.md`, `tests/verify/production-docker-files.ts`, `e2e/root-redirect.spec.ts`.

---

## Scope Notes

Tasks 1–6 from the original plan are already committed to this branch. This plan covers only the three gaps identified in the brainstorming session plus the final live rehearsal.

**Already committed — do not redo:**
- Production Node bundles (`build:daemon`, `build:prod`, `migrate-prod.ts`, `build-daemon.mjs`)
- Production Dockerfile (runner image with git/ssh/curl/claude-code)
- Homelab Compose templates (`docker-compose.yml`, `fluxaos.env.example`)
- Source-build update script (`ops/docker/homelab/build.sh`)
- Drift verification (`tests/verify/production-docker-files.ts`, `verify:prod-docker`)
- Documentation (`README.md`, `ops/README.md`)

---

## File Structure

| File | Action | Change |
|------|--------|--------|
| `ops/docker/homelab/docker-compose.yml` | Modify | Add SSH bind-mount to both `fluxaos-web` and `fluxaos-daemon` volumes |
| `ops/docker/homelab/fluxaos.env.example` | Modify | Add comment to `REDIS_URL` line pointing operator to dev `.env` |
| `ops/README.md` | Modify | Fix `git clone` commands to SSH; add remote-correction step; restore GitHub token API note |
| `tests/verify/production-docker-files.ts` | Modify | Assert SSH mount present on both services; update REDIS_URL comment assertion |
| `e2e/root-redirect.spec.ts` | Create | One test: navigate `/`, assert redirect to `/default/admin/fluxaos` |

---

## Task 1: Add SSH Mount to Both Compose Services

**Files:**
- Modify: `ops/docker/homelab/docker-compose.yml`
- Modify: `tests/verify/production-docker-files.ts`

`build.sh` runs a `git push --dry-run` preflight from a `fluxaos-web` one-shot container (lines 158–164 in `build.sh`), and the daemon pushes deploy branches during normal operation. Both services need the SSH mount. The spec says "The web container does not need this mount" — that referred to routine web serving, not the `build.sh` preflight. Both get the mount.

- [ ] **Step 1: Add SSH mount to both services**

In `ops/docker/homelab/docker-compose.yml`, the `fluxaos-web` volumes block currently reads:

```yaml
    volumes:
      - /mnt/stacks/docker/fluxaos/repos:/repos
      - /mnt/stacks/docker/fluxaos/worktrees:/runtime/worktrees
      - /mnt/stacks/docker/fluxaos/artifacts:/runtime/artifacts
```

Replace it with:

```yaml
    volumes:
      - /mnt/stacks/docker/fluxaos/repos:/repos
      - /mnt/stacks/docker/fluxaos/worktrees:/runtime/worktrees
      - /mnt/stacks/docker/fluxaos/artifacts:/runtime/artifacts
      - /home/jpierce/.ssh:/root/.ssh:ro
```

The `fluxaos-daemon` volumes block currently reads:

```yaml
    volumes:
      - /mnt/stacks/docker/fluxaos/repos:/repos
      - /mnt/stacks/docker/fluxaos/worktrees:/runtime/worktrees
      - /mnt/stacks/docker/fluxaos/artifacts:/runtime/artifacts
```

Replace it with:

```yaml
    volumes:
      - /mnt/stacks/docker/fluxaos/repos:/repos
      - /mnt/stacks/docker/fluxaos/worktrees:/runtime/worktrees
      - /mnt/stacks/docker/fluxaos/artifacts:/runtime/artifacts
      - /home/jpierce/.ssh:/root/.ssh:ro
```

- [ ] **Step 2: Update the drift verifier to assert the SSH mount on both services**

In `tests/verify/production-docker-files.ts`, find the block of `assertIncludes` calls for the compose file. After the assertion for `stop_grace_period: 120s`, add:

```ts
assertIncludes('ops/docker/homelab/docker-compose.yml', compose, '/home/jpierce/.ssh:/root/.ssh:ro');
```

One assertion is sufficient — the mount string appears twice (once per service), so `includes` will match.

- [ ] **Step 3: Verify compose syntax**

Run:

```bash
cp ops/docker/homelab/fluxaos.env.example /tmp/fluxaos-verify.env
docker compose -f ops/docker/homelab/docker-compose.yml --env-file /tmp/fluxaos-verify.env config > /dev/null
rm /tmp/fluxaos-verify.env
```

Expected: exits 0 with no errors.

- [ ] **Step 4: Run the drift verifier**

Run:

```bash
npm run verify:prod-docker
```

Expected: prints `production Docker files verified`.

- [ ] **Step 5: Commit Task 1**

Run:

```bash
git add ops/docker/homelab/docker-compose.yml tests/verify/production-docker-files.ts
git commit -m "ops: mount host SSH credentials into both web and daemon containers

build.sh runs a git push --dry-run preflight from a fluxaos-web one-shot
container; the daemon pushes branches during operation. Both need the mount.

Refs FLX-100"
```

---

## Task 2: Fix Authenticated Redis and SSH Runbook Instructions

**Files:**
- Modify: `ops/docker/homelab/fluxaos.env.example`
- Modify: `ops/README.md`

- [ ] **Step 1: Add source comment to REDIS_URL in env example**

In `ops/docker/homelab/fluxaos.env.example`, find:

```dotenv
REDIS_URL=redis://:password@central_redis:6379
```

Replace with:

```dotenv
# Copy REDIS_URL from /mnt/dev/fluxaos/.env and replace 'localhost' with 'central_redis'.
REDIS_URL=redis://:replace-me@central_redis:6379
```

- [ ] **Step 2: Fix git clone commands in ops/README.md**

In `ops/README.md`, find:

```bash
git clone https://github.com/fluxaOS/fluxaos.git /mnt/stacks/docker/fluxaos/source
mkdir -p /mnt/stacks/docker/fluxaos/repos/fluxaOS
git clone https://github.com/fluxaOS/fluxaos.git /mnt/stacks/docker/fluxaos/repos/fluxaOS/fluxaos
```

Replace with:

```bash
git clone git@github.com:fluxaOS/fluxaos.git /mnt/stacks/docker/fluxaos/source
mkdir -p /mnt/stacks/docker/fluxaos/repos/fluxaOS
git clone git@github.com:fluxaOS/fluxaos.git /mnt/stacks/docker/fluxaos/repos/fluxaOS/fluxaos
```

- [ ] **Step 3: Replace the Git auth paragraph in the runbook**

In `ops/README.md`, find the paragraph that starts with "Configure the target clone for production Git writes before running `build.sh`:" and its associated code block:

~~~
git -C /mnt/stacks/docker/fluxaos/repos/fluxaOS/fluxaos config user.name "fluxaOS"
git -C /mnt/stacks/docker/fluxaos/repos/fluxaOS/fluxaos config user.email "fluxaos@users.noreply.github.com"
git -C /mnt/stacks/docker/fluxaos/repos/fluxaOS/fluxaos push --dry-run origin HEAD:refs/heads/fluxaos-preflight-check
~~~

Replace the introductory sentence and code block with the following (the replacement itself contains fenced code blocks, so it is shown here with `~~~` outer delimiters):

~~~
Configure the target clone for production Git writes before running `build.sh`. Both source and target clones must use SSH remotes. Both the `fluxaos-web` and `fluxaos-daemon` containers mount `/home/jpierce/.ssh:/root/.ssh:ro` so the operator's SSH key is available inside containers. `FLUXAOS_GITHUB_TOKEN` remains required for GitHub API operations (PR creation via the deploy bridge); SSH covers Git CLI push only.

If the target clone was previously set to an HTTPS remote, correct it to SSH:

```bash
git -C /mnt/stacks/docker/fluxaos/repos/fluxaOS/fluxaos remote set-url origin git@github.com:fluxaOS/fluxaos.git
```

Then set Git identity and verify write access:

```bash
git -C /mnt/stacks/docker/fluxaos/repos/fluxaOS/fluxaos config user.name "fluxaOS"
git -C /mnt/stacks/docker/fluxaos/repos/fluxaOS/fluxaos config user.email "fluxaos@users.noreply.github.com"
git -C /mnt/stacks/docker/fluxaos/repos/fluxaOS/fluxaos push --dry-run origin HEAD:refs/heads/fluxaos-preflight-check
```
~~~

- [ ] **Step 4: Fix the actual target repo remote on disk**

Run:

```bash
git -C /mnt/stacks/docker/fluxaos/repos/fluxaOS/fluxaos remote get-url origin
git -C /mnt/stacks/docker/fluxaos/repos/fluxaOS/fluxaos remote set-url origin git@github.com:fluxaOS/fluxaos.git
git -C /mnt/stacks/docker/fluxaos/repos/fluxaOS/fluxaos push --dry-run origin HEAD:refs/heads/fluxaos-preflight-check
```

Expected: first line shows the old HTTPS URL. Third command exits 0, confirming SSH write access from the host.

- [ ] **Step 5: Update the drift verifier for the REDIS_URL example change**

Task 2 Step 1 changed `fluxaos.env.example` from `redis://:password@central_redis:6379` to `redis://:replace-me@central_redis:6379`. The drift verifier at `tests/verify/production-docker-files.ts` asserts the old literal. Update it to match:

In `tests/verify/production-docker-files.ts`, find:

```ts
  'REDIS_URL=redis://:password@central_redis:6379',
```

Replace with:

```ts
  'REDIS_URL=redis://:replace-me@central_redis:6379',
```

- [ ] **Step 6: Run drift verifier**

Run:

```bash
npm run verify:prod-docker
```

Expected: prints `production Docker files verified`.

- [ ] **Step 7: Commit Task 2**

Run:

```bash
git add ops/docker/homelab/fluxaos.env.example ops/README.md tests/verify/production-docker-files.ts
git commit -m "ops: fix Redis auth comment and SSH git clone instructions in runbook

Refs FLX-100"
```

---

## Task 3: Playwright Spec for Root Redirect

**Files:**
- Create: `e2e/root-redirect.spec.ts`

`src/app/page.tsx` exports `dynamic = 'force-dynamic'` so the DB-backed root redirect runs at request time, not during the Docker build. Without a spec touching this file in the PR diff, the pre-push Gate 3 blocks the push. This spec proves the redirect fires and satisfies the gate permanently. No daemon or Anthropic API key required — only a running dev server with seeded data.

- [ ] **Step 1: Confirm the dev server is running**

Run:

```bash
curl -fsS http://192.168.54.101:3003/api/health | grep '"status":"healthy"'
```

Expected: exits 0. If not running, in a separate terminal:

```bash
FLUXAOS_LAN_AUTH_BYPASS=1 npm run dev -- -p 3003
```

Wait until the terminal shows `Ready` before continuing.

- [ ] **Step 2: Create `e2e/root-redirect.spec.ts`**

Create the file with this exact content:

```ts
// e2e/root-redirect.spec.ts
//
// Verifies that GET / redirects to the seeded project dashboard at
// /{org}/{user}/{project} at request time (not statically rendered).
//
// src/app/page.tsx exports `dynamic = 'force-dynamic'` to ensure the
// DB-backed redirect runs on every request. This spec is the Gate 3
// coverage for that change.
//
// No daemon or Anthropic credentials required.

import { expect, test } from './helpers/setup';

test.describe('@root-redirect @journey', () => {
  test('GET / redirects to seeded project dashboard', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/default\/admin\/fluxaos/, {
      timeout: 15_000,
    });
  });
});
```

- [ ] **Step 3: Run the spec green**

Run:

```bash
PLAYWRIGHT_BASE_URL=http://192.168.54.101:3003 FLUXAOS_LAN_AUTH_BYPASS=1 npx playwright test e2e/root-redirect.spec.ts --reporter=list
```

Expected: `1 passed`, 0 failures.

- [ ] **Step 4: Commit Task 3**

Run:

```bash
git add e2e/root-redirect.spec.ts
git commit -m "test(e2e): cover root redirect force-dynamic behavior

Refs FLX-100"
```

---

## Task 3.5: Push Tasks 1–3 Before Rehearsal

Gate 3 is satisfied once `e2e/root-redirect.spec.ts` is in the push range (Task 3). Push now so the source checkout at `/mnt/stacks/docker/fluxaos/source` can be updated to the actual branch HEAD in Task 4a.

- [ ] **Step 1: Push the branch**

Run:

```bash
git push origin flx-100-production-docker-design
```

Expected: pre-push hook passes all gates — no `FLUXAOS_SKIP_PREPUSH_GATE` needed. Gate 3 passes because `e2e/root-redirect.spec.ts` is in the diff.

---

## Task 4a: Build Env File and Run Preflights

**Files:**
- No new committed files. Operator bootstrap steps only.

This task builds `/mnt/stacks/docker/fluxaos/fluxaos.env` and verifies all preflights before `build.sh` runs. If anything fails here, fix it before proceeding to Task 4b.

- [ ] **Step 1: Stop the dev server if it is running on port 3003**

Port 3003 is mapped to the production web container. The dev server and production container cannot both bind port 3003 simultaneously.

Run:

```bash
lsof -ti :3003 | xargs -r kill -TERM
```

Expected: exits 0 (no output if nothing was listening, or kills the dev server process).

- [ ] **Step 2: Update source checkout to current branch HEAD**

Run:

```bash
git -C /mnt/stacks/docker/fluxaos/source fetch origin
git -C /mnt/stacks/docker/fluxaos/source checkout flx-100-production-docker-design
git -C /mnt/stacks/docker/fluxaos/source pull origin flx-100-production-docker-design
git -C /mnt/stacks/docker/fluxaos/source rev-parse HEAD
git rev-parse HEAD
```

Expected: the last two lines print the same SHA — source checkout matches the current worktree HEAD.

- [ ] **Step 3: Copy updated stack templates**

Run:

```bash
cp /mnt/dev/fluxaos/.worktrees/flx-100-production-docker/ops/docker/homelab/docker-compose.yml /mnt/stacks/docker/fluxaos/docker-compose.yml
cp /mnt/dev/fluxaos/.worktrees/flx-100-production-docker/ops/docker/homelab/build.sh /mnt/stacks/docker/fluxaos/build.sh
chmod +x /mnt/stacks/docker/fluxaos/build.sh
```

- [ ] **Step 4: Build `fluxaos.env` from dev env files**

Run:

```bash
# Merge .env and .env.local; substitute Redis hostname; deduplicate (last occurrence wins)
{
  grep -v '^#' /mnt/dev/fluxaos/.env | grep -v '^$'
  grep -v '^#' /mnt/dev/fluxaos/.env.local | grep -v '^$'
} | tac | awk -F= '!seen[$1]++' | tac \
  | sed 's|redis://\(.*\)@localhost:|redis://\1@central_redis:|' \
  > /mnt/stacks/docker/fluxaos/fluxaos.env

# Append runtime paths that point at container paths (override any dev values)
cat >> /mnt/stacks/docker/fluxaos/fluxaos.env <<'EOF'
FLUXAOS_TARGET_REPO_PATH=/repos/fluxaOS/fluxaos
FLUXAOS_WORKSPACE_ROOT=/runtime/worktrees
FLUXAOS_ARTIFACTS_ROOT=/runtime/artifacts
FLUXAOS_DAEMON_SHUTDOWN_GRACE_SECONDS=120
EOF
```

- [ ] **Step 5: Verify `fluxaos.env` has the correct values**

Run:

```bash
# All required keys must be present
for key in DATABASE_URL DIRECT_URL NEXT_PUBLIC_SUPABASE_URL NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY \
           SUPABASE_SERVICE_ROLE_KEY ANTHROPIC_API_KEY FLUXAOS_GITHUB_TOKEN REDIS_URL \
           FLUXAOS_TARGET_REPO_PATH FLUXAOS_WORKSPACE_ROOT FLUXAOS_ARTIFACTS_ROOT \
           FLUXAOS_DAEMON_SHUTDOWN_GRACE_SECONDS FLUXAOS_CLEANUP_SWEEP_INTERVAL_MIN \
           FLUXAOS_CLEANUP_STALE_DAYS FLUXAOS_CLEANUP_SESSION_RETENTION_DAYS \
           FLUXAOS_CLEANUP_ARTIFACTS_RETENTION_DAYS; do
  grep -q "^${key}=" /mnt/stacks/docker/fluxaos/fluxaos.env || echo "MISSING: ${key}"
done

# Redis must be authenticated and pointing at central_redis
grep -E '^REDIS_URL=redis://:[^@]+@central_redis:6379' /mnt/stacks/docker/fluxaos/fluxaos.env \
  || echo "FAIL: REDIS_URL is not in authenticated central_redis form"

# Target path must be container path (not host /mnt/... path)
grep '^FLUXAOS_TARGET_REPO_PATH=/repos/' /mnt/stacks/docker/fluxaos/fluxaos.env \
  || echo "FAIL: FLUXAOS_TARGET_REPO_PATH is not a container path"

# Grace seconds must be 120
grep '^FLUXAOS_DAEMON_SHUTDOWN_GRACE_SECONDS=120$' /mnt/stacks/docker/fluxaos/fluxaos.env \
  || echo "FAIL: FLUXAOS_DAEMON_SHUTDOWN_GRACE_SECONDS is not 120"
```

Expected: no `MISSING:` or `FAIL:` lines.

- [ ] **Step 6: Probe in-container SSH before running build.sh**

Run:

```bash
FLUXAOS_IMAGE=fluxaos:internal-dev docker compose \
  -f /mnt/stacks/docker/fluxaos/docker-compose.yml \
  --env-file /mnt/stacks/docker/fluxaos/fluxaos.env \
  run --rm --no-deps fluxaos-daemon \
  ssh -o StrictHostKeyChecking=yes -T git@github.com 2>&1 | grep -i 'successfully authenticated'
```

Expected: prints a line containing `successfully authenticated` (e.g. `Hi jdpierce21! You've successfully authenticated`).

If this fails with `Host key verification failed`, the container's `/root/.ssh/known_hosts` (mounted from `/home/jpierce/.ssh/known_hosts`) does not contain `github.com`. Run `ssh-keyscan github.com >> ~/.ssh/known_hosts` on the host and retry.

If this fails with `Permission denied`, the SSH key file permissions inside the container may be wrong — run `ls -la ~/.ssh/` on the host and confirm `id_ed25519` is `600` and `.ssh/` is `700`.

Note: this step requires `fluxaos:internal-dev` to already exist locally. If the image does not exist yet (first deploy), skip this step and rely on build.sh's own preflight.

---

## Task 4b: Run build.sh and Confirm Instance Is Live

- [ ] **Step 1: Run `build.sh`**

Run:

```bash
/mnt/stacks/docker/fluxaos/build.sh
```

Expected: script runs to completion, exits 0. You will see:

- Stack path and source checkout verification
- Git fetch and checkout of source to current SHA
- Rollback marker written (or "first deployment" message)
- Docker build output (`fluxaos:<sha>` and `fluxaos:internal-dev`)
- `Checking runtime mounts` — passes
- `Git preflight` — `git push --dry-run` exits 0
- Migration one-shot: `migrations applied`
- Container restarts for `fluxaos-web` and `fluxaos-daemon`
- Container status table
- `fluxaos-web health check passed`
- `daemon.started orchestrator=running` found in daemon logs
- `Deployed <sha>`

**If build.sh fails at `FLUXAOS_DAEMON_SHUTDOWN_GRACE_SECONDS must be 120`:** Task 4a Step 5 should have caught this — recheck `fluxaos.env`.

**If build.sh fails at `central_redis redis-cli ping did not return PONG`:** The Redis URL in `fluxaos.env` is wrong — recheck Task 4a Step 5 Redis assertion.

**If build.sh fails at the in-container `git push --dry-run`:** The SSH mount is not working inside the `fluxaos-web` container. Confirm Task 1 added the mount to both services and the templates were copied in Task 4a Step 3.

**If build.sh fails at `FLUXAOS_WORKSPACE_ROOT must be /runtime/worktrees`:** The `tac/awk` dedup in Task 4a Step 4 did not override the dev value — inspect `fluxaos.env` and verify the appended override block is last.

- [ ] **Step 2: Confirm the UI loads**

Open `http://192.168.54.101:3003` in a browser.

Expected: fluxaOS UI loads, redirects to `/default/admin/fluxaos`, dashboard renders normally. This is the FLX-100 completion bar.

- [ ] **Step 3: Note the rollback marker for reference**

Run:

```bash
ls /mnt/stacks/docker/fluxaos/rollback/
cat /mnt/stacks/docker/fluxaos/deployed-sha
```

If a rollback is ever needed after a future deploy, use:

```bash
PREV_SHA=$(cat /mnt/stacks/docker/fluxaos/rollback/<latest-marker>.sha)
cd /mnt/stacks/docker/fluxaos
FLUXAOS_IMAGE=fluxaos:${PREV_SHA} docker compose up -d --force-recreate fluxaos-web fluxaos-daemon
```

---

## Task 4c: Update PR and Linear

- [ ] **Step 1: Update PR #194 description**

Append a rehearsal-complete section to the existing PR body:

```bash
EXISTING_BODY=$(gh pr view 194 --json body --jq '.body')
gh pr edit 194 --body "${EXISTING_BODY}

## Rehearsal complete

Production instance deployed at http://192.168.54.101:3003. \`build.sh\` ran to completion against the real homelab stack. Web UI loads and redirects to project dashboard. Daemon container running."
```

Expected: `gh pr edit` exits 0. Run `gh pr view 194 --json body --jq '.body' | tail -6` to confirm the section was appended.

- [ ] **Step 2: Update Linear FLX-100 to In Review**

Using the Linear MCP, set FLX-100 status to `In Review` and attach PR #194 if not already linked.

---

## Plan Self-Review

**Spec coverage:**

| Spec section | Task |
|---|---|
| SSH mount on both services | Task 1 |
| SSH remotes + runbook | Task 2 |
| Redis auth env example + comment | Task 2 |
| `FLUXAOS_GITHUB_TOKEN` API note preserved | Task 2 Step 3 |
| Playwright root-redirect spec | Task 3 |
| Push before rehearsal (SHA race fix) | Task 3.5 |
| Grace seconds = 120 override | Task 4a Step 4 |
| Redis URL authenticated form assertion | Task 4a Step 5 |
| Dev server port collision guard | Task 4a Step 1 |
| In-container SSH probe | Task 4a Step 6 |
| Completion bar: build.sh exits 0 | Task 4b Step 1 |
| Completion bar: UI loads at 3003 | Task 4b Step 2 |
| Rollback awareness | Task 4b Step 3 |
| PR + Linear hygiene | Task 4c |

**Placeholder scan:** No TBD, no TODO, no "similar to" references. All shell commands have expected output or explicit failure-mode pointers.

**Type consistency:** No shared types. Each task is independently re-runnable.
