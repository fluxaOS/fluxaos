# Session Handoff — FLX-100 Production Docker Rehearsal Complete

**Date:** 2026-04-30 ~07:15 PDT → 2026-04-30 ~07:30 PDT  
**Operator:** Joseph Pierce  
**Branch at start:** `main` at `27ce157`  
**Branch at end:** `main` at `5e585b2`  
**Session boundary used:** `2026-04-30T04:19:53-07:00` (latest prior session-end marker)  
**Session boundary note:** Multiple session-start markers exist from session restart attempts; using the latest session-end as the conservative boundary.

---

## Session Scope

This session completed FLX-100 end-to-end. The prior session left PR #194 open with three implementation gaps (SSH auth, authenticated Redis, Playwright Gate 3 coverage) and an unpushed handoff commit blocked by the pre-push hook. This session ran the `superpowers:brainstorming` repair pass, wrote a new implementation plan, put it through three independent code review passes, then executed it via subagent-driven development. After the initial implementations merged, `build.sh` was run against the real homelab stack and two additional bugs were caught and fixed (busybox `test` incompatibility, Next.js HOSTNAME binding). The production instance is now live at `http://192.168.54.101:3003` — confirmed by the operator in the browser.

---

## What Shipped

### PR #194 — `feat: add FLX-100 production Docker rehearsal`
The main implementation PR. After this session:
- SSH mount added to both `fluxaos-web` and `fluxaos-daemon` (build.sh runs an in-container dry-run push from the web container).
- `fluxaos.env.example` REDIS_URL placeholder changed from `:password` to `:replace-me` with a directing comment.
- `ops/README.md` clone commands changed from HTTPS to SSH; Git auth paragraph updated to explain the SSH mount approach.
- Drift verifier updated for both changes.
- `e2e/root-redirect.spec.ts` added — Gate 3 now passes cleanly without any bypass.
- Spec and plan updated to document the durable design decisions.

### PR #195 — `fix(docker): fix busybox-compatible writable mount probe`
Alpine sh (busybox) does not support `test -d -w path` as a combined expression. Split into `test -d` and `test -w` as separate invocations.

### PR #196 — `fix(docker): set HOSTNAME=0.0.0.0 and use GIT_SSH_COMMAND for in-container SSH`
Two runtime blockers caught during the real `build.sh` run:
- `HOSTNAME="0.0.0.0"` needed in compose so Next.js standalone server binds to all interfaces, not just the container's own hostname. Without this, `curl http://127.0.0.1:3000` inside the container fails.
- `GIT_SSH_COMMAND` set in the in-container git push preflight to bypass `/root/.ssh/config`. OpenSSH rejects the config file when it is owned by the host operator UID (1000) but the container runs as root (0). Using `-F /dev/null` skips the config; using `-i /root/.ssh/id_ed25519` selects the key directly.

---

## Incidents and Root Causes

### Redis `redis-cli -u` auth failure — explicit `default` user required
The build.sh preflight uses `redis-cli -u "${redis_url}"`. Redis 7+ with ACLs requires the username to be explicit in the URL (`redis://default:password@host:port`). The URL form `redis://:password@host:port` sends an empty username, which fails ACL auth even though `AUTH password` (via `-a`) works fine. Fixed by using `redis://default:password@central_redis:6379` in `fluxaos.env`. ioredis (used by the app) handles this form correctly.

### Target repo remote was HTTPS with embedded token
`/mnt/stacks/docker/fluxaos/repos/fluxaOS/fluxaos` had `https://x-access-token:TOKEN@github.com/...` as its origin. Fixed on disk with `git remote set-url` and documented in the runbook with a remote-correction step.

### SSH config ownership check blocks root containers
The operator's `/home/jpierce/.ssh/config` is owned by UID 1000. Mounted into a container running as root (UID 0), OpenSSH refuses to load it. Workaround: set `GIT_SSH_COMMAND` with `-F /dev/null` for in-container git operations, selecting the key explicitly with `-i /root/.ssh/id_ed25519`.

---

## Verification Matrix

| Check | Result |
|-------|--------|
| `npm run lint` | 0 errors |
| `npm run verify:prod-docker` | All assertions pass |
| `bash -n ops/docker/homelab/build.sh` | Syntax clean |
| `npx playwright test e2e/root-redirect.spec.ts` | 1 passed |
| Gate 3 (pre-push hook) | Passes cleanly — no bypass |
| `/mnt/stacks/docker/fluxaos/build.sh` | Exit 0 — image built, migrations applied, containers running, daemon sentinel emitted, deployed-sha written |
| `http://192.168.54.101:3003/api/health` | `status: healthy`, all adapters green |
| Browser verification | Operator confirmed UI loads on titan |

---

## Current State

- **HEAD:** `main` at `5e585b2` (up to date with `origin/main`)
- **Working tree:** clean
- **Branches:** no feature branches; main only
- **Worktrees:** none (flx-100-production-docker pruned this session)
- **Production stack:** `/mnt/stacks/docker/fluxaos/` running `fluxaos:08878b73` (tagged as `internal-dev`)
- **Deployed SHA:** `08878b7` written to `/mnt/stacks/docker/fluxaos/deployed-sha`
- **Dev server:** not running (killed for Playwright test; production containers serve port 3003)

---

## Roadmap State

FLX-100 is marked **Done** in Linear with PR links for #194, #195, #196. The production Docker phase is complete. The fluxaOS homelab instance now runs from Docker on titan and will be updated going forward via `build.sh`.

---

## Files Touched

**Committed to main this session:**
- `ops/docker/homelab/docker-compose.yml` — SSH mount on both services, `HOSTNAME="0.0.0.0"` on web
- `ops/docker/homelab/build.sh` — busybox test fix, `GIT_SSH_COMMAND` for in-container git push preflight
- `ops/docker/homelab/fluxaos.env.example` — REDIS_URL placeholder → `:replace-me` with comment
- `ops/README.md` — SSH clone instructions, remote-correction step, Git auth paragraph
- `tests/verify/production-docker-files.ts` — assertions for SSH mount, HOSTNAME, GIT_SSH_COMMAND, replace-me REDIS_URL
- `e2e/root-redirect.spec.ts` — new Playwright spec covering root redirect (satisfies Gate 3)
- `docs/superpowers/specs/2026-04-30-flx-100-production-docker-design.md` — updated with resolved gap decisions
- `docs/superpowers/plans/2026-04-30-flx-100-production-docker.md` — replaced with repair plan (gap-only tasks)

**Stack files updated on disk (not in repo):**
- `/mnt/stacks/docker/fluxaos/docker-compose.yml`
- `/mnt/stacks/docker/fluxaos/build.sh`
- `/mnt/stacks/docker/fluxaos/fluxaos.env` (operator secret — not committed)
- `/mnt/stacks/docker/fluxaos/deployed-sha`

---

## Memories Saved This Session

None explicitly requested. The key runtime learnings (Redis ACL URL form, SSH config ownership, busybox test syntax) are all captured in committed code and this handoff.

---

## Next-Session Prompt

fluxaOS session closed on `main` at `5e585b2`.

FLX-100 is complete. Production instance is live at `http://192.168.54.101:3003`. Future updates: run `/mnt/stacks/docker/fluxaos/build.sh` after changes merge to main.

Check the roadmap (`docs/superpowers/roadmap.md`) for the next workstream. No open PRs, no in-flight branches.
