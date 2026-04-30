# FLX-100 Production Docker — Repair and Complete

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the FLX-100 production Docker instance by closing three spec gaps (SSH Git auth, authenticated Redis, Playwright root-redirect coverage) and running a real `build.sh` deployment that produces a working instance at `http://192.168.54.101:3003`.

**Architecture:** Tasks 1-3 are parallel file changes (each small, independent). Task 4 is the live rehearsal — it depends on Tasks 1-3 being committed and deployed. The Playwright spec (Task 3) must run green before any push so Gate 3 passes cleanly.

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
| `ops/docker/homelab/docker-compose.yml` | Modify | Add SSH bind-mount to `fluxaos-daemon` volumes |
| `ops/docker/homelab/fluxaos.env.example` | Modify | Add comment to `REDIS_URL` line pointing operator to dev `.env` |
| `ops/README.md` | Modify | Fix `git clone` commands to SSH; add remote-correction step |
| `tests/verify/production-docker-files.ts` | Modify | Assert SSH mount in compose; update REDIS_URL comment assertion |
| `e2e/root-redirect.spec.ts` | Create | One test: navigate `/`, assert redirect to `/default/admin/fluxaos` |

---

## Task 1: Add SSH Mount to Daemon Compose Service

**Files:**
- Modify: `ops/docker/homelab/docker-compose.yml`
- Modify: `tests/verify/production-docker-files.ts`

The daemon creates git worktrees and pushes branches to GitHub. It needs the host SSH key available inside the container. The web service does not push to Git and does not need this mount.

- [ ] **Step 1: Add SSH mount to `fluxaos-daemon` volumes**

In `ops/docker/homelab/docker-compose.yml`, the `fluxaos-daemon` service `volumes` block currently reads:

```yaml
    volumes:
      - /mnt/stacks/docker/fluxaos/repos:/repos
      - /mnt/stacks/docker/fluxaos/worktrees:/runtime/worktrees
      - /mnt/stacks/docker/fluxaos/artifacts:/runtime/artifacts
```

Change it to:

```yaml
    volumes:
      - /mnt/stacks/docker/fluxaos/repos:/repos
      - /mnt/stacks/docker/fluxaos/worktrees:/runtime/worktrees
      - /mnt/stacks/docker/fluxaos/artifacts:/runtime/artifacts
      - /home/jpierce/.ssh:/root/.ssh:ro
```

The `fluxaos-web` volumes block is unchanged.

- [ ] **Step 2: Update the drift verifier to assert the SSH mount**

In `tests/verify/production-docker-files.ts`, find the existing assertions on the compose file. After the existing `assertIncludes` calls for the compose file (near where `stop_grace_period` and `depends_on` are checked), add:

```ts
assertIncludes('ops/docker/homelab/docker-compose.yml', compose, '/home/jpierce/.ssh:/root/.ssh:ro');
```

- [ ] **Step 3: Verify compose syntax still valid**

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
git commit -m "ops: mount host SSH credentials into daemon container

Refs FLX-100"
```

---

## Task 2: Fix Authenticated Redis in Env Example and Runbook

**Files:**
- Modify: `ops/docker/homelab/fluxaos.env.example`
- Modify: `ops/README.md`

The env example already has `REDIS_URL=redis://:password@central_redis:6379` from a prior commit, but lacks a comment telling the operator where to find the password. The runbook bootstrap section uses `https://` git clone URLs that fail non-interactively.

- [ ] **Step 1: Add source comment to REDIS_URL in env example**

In `ops/docker/homelab/fluxaos.env.example`, find the line:

```dotenv
REDIS_URL=redis://:password@central_redis:6379
```

Replace it with:

```dotenv
# Copy REDIS_URL from /mnt/dev/fluxaos/.env and replace 'localhost' with 'central_redis'.
REDIS_URL=redis://:replace-me@central_redis:6379
```

- [ ] **Step 2: Fix git clone commands in ops/README.md bootstrap section**

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

- [ ] **Step 3: Add remote-correction step to runbook**

In `ops/README.md`, find the paragraph that starts with "Configure the target clone for production Git writes before running `build.sh`:" and its associated code block:

```bash
git -C /mnt/stacks/docker/fluxaos/repos/fluxaOS/fluxaos config user.name "fluxaOS"
git -C /mnt/stacks/docker/fluxaos/repos/fluxaOS/fluxaos config user.email "fluxaos@users.noreply.github.com"
git -C /mnt/stacks/docker/fluxaos/repos/fluxaOS/fluxaos push --dry-run origin HEAD:refs/heads/fluxaos-preflight-check
```

Replace it with:

```bash
# If the target clone was previously set to an HTTPS remote, correct it to SSH:
git -C /mnt/stacks/docker/fluxaos/repos/fluxaOS/fluxaos remote set-url origin git@github.com:fluxaOS/fluxaos.git

git -C /mnt/stacks/docker/fluxaos/repos/fluxaOS/fluxaos config user.name "fluxaOS"
git -C /mnt/stacks/docker/fluxaos/repos/fluxaOS/fluxaos config user.email "fluxaos@users.noreply.github.com"
git -C /mnt/stacks/docker/fluxaos/repos/fluxaOS/fluxaos push --dry-run origin HEAD:refs/heads/fluxaos-preflight-check
```

Also update the paragraph text above that block. Find:

```
The dry-run push must succeed from the host and from the production container preflight. Use an authenticated remote that works non-interactively for Git CLI push; `FLUXAOS_GITHUB_TOKEN` is still required for GitHub API operations, but Git itself also needs writable credentials through the target repo remote/config.
```

Replace with:

```
Both source and target clones must use SSH remotes (`git@github.com:...`). The daemon container mounts `/home/jpierce/.ssh:/root/.ssh:ro` so the same SSH key that works on the host is available inside the container. The dry-run push verifies write access before any build or migration runs.
```

- [ ] **Step 4: Fix the actual target repo remote on disk**

Run:

```bash
git -C /mnt/stacks/docker/fluxaos/repos/fluxaOS/fluxaos remote get-url origin
git -C /mnt/stacks/docker/fluxaos/repos/fluxaOS/fluxaos remote set-url origin git@github.com:fluxaOS/fluxaos.git
git -C /mnt/stacks/docker/fluxaos/repos/fluxaOS/fluxaos remote get-url origin
```

Expected: first line shows the old HTTPS URL, third line shows `git@github.com:fluxaOS/fluxaos.git`.

- [ ] **Step 5: Verify dry-run push works via SSH from host**

Run:

```bash
git -C /mnt/stacks/docker/fluxaos/repos/fluxaOS/fluxaos push --dry-run origin HEAD:refs/heads/fluxaos-preflight-check
```

Expected: exits 0. Output contains `To github.com:fluxaOS/fluxaos.git` — confirms SSH auth works.

- [ ] **Step 6: Run drift verifier**

Run:

```bash
npm run verify:prod-docker
```

Expected: prints `production Docker files verified`.

- [ ] **Step 7: Commit Task 2**

Run:

```bash
git add ops/docker/homelab/fluxaos.env.example ops/README.md
git commit -m "ops: fix Redis auth comment and SSH git clone instructions

Refs FLX-100"
```

---

## Task 3: Playwright Spec for Root Redirect

**Files:**
- Create: `e2e/root-redirect.spec.ts`

`src/app/page.tsx` exports `dynamic = 'force-dynamic'` so the DB-backed root redirect runs at request time, not during the Docker build. Without a spec touching this file in the PR diff, the pre-push Gate 3 blocks the push. This spec proves the redirect fires and satisfies the gate permanently.

No daemon, no Anthropic API key required — only a running dev server with seeded data.

- [ ] **Step 1: Start the dev server if not already running**

The dev server must be running at `http://192.168.54.101:3003` with seeded data. Confirm:

```bash
curl -fsS http://192.168.54.101:3003/api/health | grep '"status":"healthy"'
```

Expected: exits 0. If not running, in a separate terminal:

```bash
FLUXAOS_LAN_AUTH_BYPASS=1 npm run dev -- -p 3003
```

And wait for it to be ready.

- [ ] **Step 2: Create `e2e/root-redirect.spec.ts`**

Create the file with this content:

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

- [ ] **Step 3: Run the spec and confirm it passes**

Run:

```bash
PLAYWRIGHT_BASE_URL=http://192.168.54.101:3003 FLUXAOS_LAN_AUTH_BYPASS=1 npx playwright test e2e/root-redirect.spec.ts --reporter=list
```

Expected: 1 test passes, 0 failures.

- [ ] **Step 4: Commit Task 3**

Run:

```bash
git add e2e/root-redirect.spec.ts
git commit -m "test(e2e): cover root redirect force-dynamic behavior

Refs FLX-100"
```

---

## Task 4: Live Build.sh Rehearsal

**Files:**
- No new files. Operator bootstrap steps only, then running `build.sh`.

This task runs the actual deployment. It depends on Tasks 1–3 being committed. The source checkout at `/mnt/stacks/docker/fluxaos/source` must be updated to the latest branch commit before building.

- [ ] **Step 1: Update the source checkout to current branch HEAD**

Run:

```bash
CURRENT_SHA=$(git rev-parse HEAD)
git -C /mnt/stacks/docker/fluxaos/source fetch origin
git -C /mnt/stacks/docker/fluxaos/source checkout flx-100-production-docker-design
git -C /mnt/stacks/docker/fluxaos/source pull origin flx-100-production-docker-design
git -C /mnt/stacks/docker/fluxaos/source rev-parse HEAD
```

Expected: last line prints the same SHA as `git rev-parse HEAD` in the worktree.

- [ ] **Step 2: Copy updated stack templates**

Run:

```bash
cp /mnt/dev/fluxaos/.worktrees/flx-100-production-docker/ops/docker/homelab/docker-compose.yml /mnt/stacks/docker/fluxaos/docker-compose.yml
cp /mnt/dev/fluxaos/.worktrees/flx-100-production-docker/ops/docker/homelab/build.sh /mnt/stacks/docker/fluxaos/build.sh
chmod +x /mnt/stacks/docker/fluxaos/build.sh
```

- [ ] **Step 3: Create `fluxaos.env` from dev env files**

Run:

```bash
# Merge .env and .env.local into fluxaos.env, substituting the Redis hostname
{
  grep -v '^#' /mnt/dev/fluxaos/.env | grep -v '^$'
  grep -v '^#' /mnt/dev/fluxaos/.env.local | grep -v '^$'
} | sed 's|redis://\(.*\)@localhost:|redis://\1@central_redis:|' \
  > /mnt/stacks/docker/fluxaos/fluxaos.env

# Add runtime paths and daemon config not in dev env
cat >> /mnt/stacks/docker/fluxaos/fluxaos.env <<'EOF'
FLUXAOS_TARGET_REPO_PATH=/repos/fluxaOS/fluxaos
FLUXAOS_WORKSPACE_ROOT=/runtime/worktrees
FLUXAOS_ARTIFACTS_ROOT=/runtime/artifacts
EOF
```

Then verify keys are present (no values printed):

```bash
grep -o '^[A-Z_]*' /mnt/stacks/docker/fluxaos/fluxaos.env | sort
```

Expected output includes: `ANTHROPIC_API_KEY`, `DATABASE_URL`, `DIRECT_URL`, `FLUXAOS_CLEANUP_ARTIFACTS_RETENTION_DAYS`, `FLUXAOS_CLEANUP_SESSION_RETENTION_DAYS`, `FLUXAOS_CLEANUP_STALE_DAYS`, `FLUXAOS_CLEANUP_SWEEP_INTERVAL_MIN`, `FLUXAOS_DAEMON_SHUTDOWN_GRACE_SECONDS`, `FLUXAOS_GITHUB_TOKEN`, `FLUXAOS_TARGET_REPO_PATH`, `FLUXAOS_WORKSPACE_ROOT`, `FLUXAOS_ARTIFACTS_ROOT`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, `REDIS_URL`, `SUPABASE_SERVICE_ROLE_KEY`.

Also verify Redis URL has `central_redis` not `localhost`:

```bash
grep '^REDIS_URL' /mnt/stacks/docker/fluxaos/fluxaos.env
```

Expected: `REDIS_URL=redis://:...@central_redis:6379`

- [ ] **Step 4: Verify target repo SSH remote and dry-run push**

Run:

```bash
git -C /mnt/stacks/docker/fluxaos/repos/fluxaOS/fluxaos remote get-url origin
git -C /mnt/stacks/docker/fluxaos/repos/fluxaOS/fluxaos push --dry-run origin HEAD:refs/heads/fluxaos-preflight-check
```

Expected: first line shows `git@github.com:fluxaOS/fluxaos.git`. Second command exits 0.

If remote is still HTTPS (from the prior session), correct it first:

```bash
git -C /mnt/stacks/docker/fluxaos/repos/fluxaOS/fluxaos remote set-url origin git@github.com:fluxaOS/fluxaos.git
```

- [ ] **Step 5: Run `build.sh`**

Run:

```bash
/mnt/stacks/docker/fluxaos/build.sh
```

Expected: script runs to completion, exits 0. You will see:

- Git fetch and checkout of source
- Docker build output (`fluxaos:<sha>` and `fluxaos:internal-dev`)
- Migration one-shot container output (`migrations applied`)
- Container restarts for `fluxaos-web` and `fluxaos-daemon`
- Container status table
- `Checking web health` — health check passes
- `Checking daemon readiness log` — `daemon.started orchestrator=running` found
- `Deployed <sha>`

If `build.sh` fails at the Redis preflight (`central_redis redis-cli ping did not return PONG`), the Redis URL in `fluxaos.env` is wrong — recheck Step 3.

If `build.sh` fails at the dry-run push preflight, SSH auth is not working inside the container — recheck the SSH mount in `docker-compose.yml` from Task 1.

- [ ] **Step 6: Confirm the UI loads**

Open `http://192.168.54.101:3003` in a browser.

Expected: fluxaOS UI loads, redirects to `/default/admin/fluxaos`, and the dashboard renders normally. This is the completion bar for FLX-100.

- [ ] **Step 7: Push the branch and update the PR**

Now that Gate 3 is satisfied (Task 3 added `e2e/root-redirect.spec.ts` to the diff), push without bypass:

```bash
git push origin flx-100-production-docker-design
```

Expected: pre-push hook passes all gates — no `FLUXAOS_SKIP_PREPUSH_GATE` needed.

Then update PR #194 description to note that the real `build.sh` rehearsal has now completed and the instance is live at `http://192.168.54.101:3003`.

---

## Plan Self-Review

**Spec coverage:**

| Spec section | Task |
|---|---|
| SSH mount on daemon, SSH remotes | Task 1 (compose), Task 2 (runbook + disk fix) |
| Redis auth — env example comment | Task 2 |
| Playwright root-redirect spec | Task 3 |
| Completion bar: build.sh exits 0 + UI loads | Task 4 |
| Completion bar: daemon processes runs | Implicit — daemon starts in Task 4 step 5 |

**Placeholder scan:** No TBD, no TODO, no "similar to" references. All commands have expected output. All code blocks are complete.

**Type consistency:** No shared types across tasks — each task is self-contained shell/YAML/TypeScript edits.
