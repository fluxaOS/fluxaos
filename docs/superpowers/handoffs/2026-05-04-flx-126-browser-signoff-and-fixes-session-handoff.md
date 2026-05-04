# FLX-126 Browser Sign-Off + Bug Fixes Session Handoff

Date: 2026-05-04 (Pacific)
Operator: Joseph Pierce
Branch at start: `main` (SHA `1b85c75`)
Branch at end: `main` (SHA `955848a`)

## Session Boundary

Session-start marker: `session-start-2026-05-04T08:00:00-07:00.md` (latest of six start markers written today). No session-end marker existed for today, so the most recent start marker was used as the boundary.

## Scope

This session was the browser sign-off pass for FLX-126 (RecordEditor migration). What started as "click through four settings pages and confirm" turned into a debugging session: the Docker prod container (port 3003) was still running pre-FLX-126 code, so the brands page had the JSON create error. After redeploying Docker, a cascade of smaller issues emerged — missing JSON fields in the create form, 87 test-created orgs polluting the database, dev server not binding to the LAN interface, and `dev-flux.jdp21.com` blocked by a missing `allowedDevOrigins` entry. All were fixed and merged. The final state is: FLX-126 fully signed off, dev environment clean, test teardown fixed, and JSON fields present in both create and edit flows.

## What Shipped

**PR #237 — `fix: exclude docs-site from website tsconfig + RecordField JSON error copy`** (merged 2026-05-04T11:04Z)

- RecordField `JsonField` catch block now emits a field-specific message (`"Colors JSON" must be valid JSON...`) rather than the raw JS `SyntaxError` string.
- Docs-site tsconfig fix (unrelated, carry-forward from prior session).

**PR #240 — `docs: clarify dev vs prod ports — dev on 3004, prod/Docker on 3003`** (merged 2026-05-04T11:34Z)

- CLAUDE.md and `docs/session-quick-start.md` updated to document prod=3003 (Docker), dev=3004, and that `npm run dev` must use `-p 3004` to avoid conflicting with the container.

**PR #244 — `test: add Brands RecordEditor journey test (FLX-126)`** (open — branch `flx-126-brands-journey-test`, not yet merged)

- `e2e/brand-screenshot.spec.ts`: journey test confirming all 6 detail-panel fields render after clicking a brand row. Passes green against dev:3004.

**PR #245 — `fix: brands create form + integration test teardown + dev config`** (merged 2026-05-04T12:20Z)

Three distinct fixes bundled:

1. **FLX-126 create-form regression** — Colors JSON, Fonts JSON, and Logo URL were dropped from the bespoke brand create form during the FLX-126 RecordEditor migration (PR #234). Restored to match the detail/edit panel. All 7 fields now present in both create and edit flows. Playwright spec `e2e/brand-create-form.spec.ts` added; screenshot saved to `tests/results/brand-create-form.png`.

2. **FLX-128 — Integration test FK teardown** — Integration tests were silently leaking one org/user/project per test run. Root cause: `afterAll` delete loops used `.catch(() => {})` which swallowed FK constraint errors, leaving orphan rows. After 87 runs, 86 orphan orgs had accumulated and populated the sidebar. Fix: added `deleteOrgFixture(db, orgId)` to `src/__tests__/integration/cleanup-fixtures.ts` — a FK-safe teardown helper (leaf-first, same order as `nuke.ts`) scoped to a single org. All 12 affected test files updated. Database manually nuked and reseeded.

3. **Dev config** — `next.config.ts` now includes `dev-flux.jdp21.com` in `allowedDevOrigins` (the DNS-named reverse proxy for dev was blocked by Next.js 16's cross-origin HMR guard). CLAUDE.md documents `-H 0.0.0.0` as required for LAN binding. Full reset command documented: `npx tsx src/scripts/db/nuke.ts && npm run db:seed && npm run dev -- -H 0.0.0.0 -p 3004`.

## Incidents & Root Causes

**Docker prod container was serving stale code (pre-FLX-126).** The brands page "JSON.parse: unexpected keyword" error on create was coming from the prod container on port 3003, not from the dev build. Resolved by running `bash /mnt/stacks/docker/fluxaos/build.sh origin/main` to redeploy to SHA `51744fb`.

**NFS `.nfs*` lock files blocking `.next` cache deletion.** The Docker container held NFS file handles on the dev machine's `.next/` directory. Could not `rm -rf .next`. Resolved by identifying the Docker container as the NFS client and redeploying it, which released the handles.

**86 orphan orgs in database.** Every integration test run leaked one org because FK teardown silently failed. Accumulated to 87 total orgs across 87 test runs. Manifested as hundreds of garbage projects populating the sidebar and settings pages. Nuked manually; FLX-128 fix prevents recurrence.

**Dev server not binding to LAN.** Without `-H 0.0.0.0`, Next.js binds to `::` (IPv6 loopback only). LAN clients get connection refused. Fixed in CLAUDE.md and session-quick-start.

**`dev-flux.jdp21.com` showing pulsing cards.** Next.js 16 blocks `/_next/webpack-hmr` requests from origins not in `allowedDevOrigins`. The HMR socket being blocked caused React hydration to stall. Fixed by adding `dev-flux.jdp21.com` to `allowedDevOrigins` in `next.config.ts`.

## Verification Matrix

| Check | Result |
|-------|--------|
| `e2e/brand-create-form.spec.ts` | ✅ Pass |
| `e2e/brand-screenshot.spec.ts` (PR #244) | ✅ Pass |
| `npx tsc --noEmit` | ✅ Clean |
| Human browser sign-off — Teams | ✅ |
| Human browser sign-off — Providers | ✅ |
| Human browser sign-off — Routing | ✅ |
| Human browser sign-off — Brands | ✅ |

FLX-126 browser sign-off is complete. All four RecordEditor-migrated settings pages confirmed working.

## Current State

- HEAD: `main` at `955848a`
- Working tree: 4 modified files — `flux`, `README.md`, `tests/flux-cli.test.sh`, `.gitignore` — all part of in-progress flux operator CLI work (yours, not committed)
- Untracked: `.smbdeleteAAA145067` (stale SMB temp file, safe to delete)
- Stashes: none
- Local branches: `main`, `flx-126-brands-journey-test` (backed by open PR #244)
- Remote branches: `origin/flx-126-brands-create-form-fix` (fully merged, can be deleted), `origin/flx-88-linear-mcp-fallback` (pre-existing, unrelated)
- Dev server: running at `http://192.168.54.101:3004` (PID 4178019, bound to `0.0.0.0:3004`)
- Prod: Docker container `fluxaos-web` at port 3003, deployed at SHA `51744fb`

## Files Touched

**New:**
- `e2e/brand-create-form.spec.ts`
- `e2e/brand-screenshot.spec.ts`
- `e2e/hydration-check.spec.ts`
- `tests/results/brand-create-form.png`
- `src/scripts/db/dbcheck.ts`

**Modified:**
- `src/app/[org]/[user]/[project]/settings/brands/page.tsx` — create form restored with all 7 fields
- `src/components/record-editor/RecordField.tsx` — field-specific JSON parse error message
- `src/__tests__/integration/cleanup-fixtures.ts` — `deleteOrgFixture()` helper added
- `src/__tests__/integration/` — 12 test files updated to use `deleteOrgFixture`
- `next.config.ts` — `allowedDevOrigins` includes `dev-flux.jdp21.com`
- `CLAUDE.md` — dev command corrected to `-H 0.0.0.0 -p 3004`
- `docs/session-quick-start.md` — dev server section updated

## Linear

- **FLX-126** — Done (browser sign-off complete this session)
- **FLX-128** — Done (PR #245, merged)
- **PR #244** — open (`flx-126-brands-journey-test`), brands detail panel journey test, ready to merge

## Memories Saved

- `feedback_keep_e2e_tests.md` — never delete e2e spec files, even debug/temp ones
- `reference_dev_server_port.md` — updated: `-H 0.0.0.0` required, full reset command documented
- `reference_lan_auth_bypass.md` — updated: port reference corrected to 3004

## Suggested Next Session

```
Continue from main at 955848a. FLX-126 RecordEditor migration fully signed
off (browser + Playwright). FLX-128 integration test teardown fixed.

Immediate: merge PR #244 (brands detail panel journey test,
flx-126-brands-journey-test branch).

Flux operator CLI is in progress (flux, README.md, tests/flux-cli.test.sh,
.gitignore uncommitted) — commit and wire up when ready.

Delete stale remote branch origin/flx-126-brands-create-form-fix (merged).

Next roadmap items: FLX-102 dogfood notes triage for actionable issues,
then post-alpha backlog (FLX-2, FLX-7, FLX-99) when direction confirmed.

Session closed. Handoff written, repo clean, marker saved.
```
