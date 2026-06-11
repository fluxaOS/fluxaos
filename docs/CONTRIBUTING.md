# Contributing to fluxaOS

Quick reference for contributors and dogfood agents. Canonical detail lives in the linked docs — don't duplicate, link.

---

## Local Setup

```bash
npm i
cp .env.example .env          # fill in Supabase URLs/keys and DATABASE_URL
# add secrets to .env.local   # ANTHROPIC_API_KEY, FLUXAOS_GITHUB_TOKEN, etc. (gitignored)
npm run db:migrate
npm run db:seed
npm run dev -- -H 0.0.0.0 -p 3004   # dev owns 3004; UAT/Docker owns 3003
```

Full env var reference and gotchas: [CLAUDE.md](../CLAUDE.md) → R-RUNTIME env vars section.

---

## Workflow

### Branches and worktrees

- Never commit directly to `main`. All work goes through PRs.
- Branch convention: `flx-NNN-short-slug` for Linear-tracked issues, or a descriptive slug for untracked work.
- Parallel agent work uses `git worktree`. After `git clone` or `git worktree add`, run hooks once:

  ```bash
  bash ops/install-hooks.sh
  ```

  Without this, `pre-commit` / `pre-push` / `commit-msg` won't fire.

### Hooks

Tracked hooks in `ops/git-hooks/` enforce:

- No direct commits to `main`
- ESLint on staged TypeScript files
- 500-line file-size cap
- Secret-file detection
- `claude-md-score: NN` trailer (≥ 90) when `CLAUDE.md` is staged

See [CLAUDE.md](../CLAUDE.md) → Worktrees & Hooks for the full list.

### Issue tracking

- **Linear** (`rebos` workspace, team `FLX`) is the roadmap and deferred-fixes source of truth.
- Dogfood issues are filed as native fluxaOS issues via the UI, not in Linear directly.
- Bug findings go to the Linear "Bug Backlog" project via MCP (`mcp__plugin_linear_linear__save_issue`).
- Frozen historical list: `docs/superpowers/deferred-fixes.md` — do not append.

### PR expectations

- Squash-merge via `gh pr merge --squash --delete-branch` (or web UI).
- CI must pass — no bypass.
- Include `Fixes FLX-NNN` or `Refs FLX-NNN` in the commit body when the work resolves a Linear issue.
- `CLAUDE.md` edits require a `claude-md-score: NN` trailer (run the `claude-md-management:claude-md-improver` skill first).

---

## Verification

Run these before opening a PR:

```bash
npm run lint          # ESLint
npm run build         # TypeScript compile + Next.js build
npx vitest            # integration tests (real Supabase — no mocks)
```

**UI work requires a passing Playwright journey test.** Lint/build/vitest passing is not sufficient evidence — you must produce mechanical proof of the user-visible behavior:

```bash
# against the LAN dev server
PLAYWRIGHT_BASE_URL=http://192.168.54.101:3004 npx playwright test e2e/<your-spec>.spec.ts
```

Reference pattern: `e2e/real-anthropic-stage-run.spec.ts`. Do not claim UI work is done without a green journey spec.

---

## Dogfooding

fluxaOS runs its own development work through the fluxaOS pipeline. Good candidates: bug fixes with clear repros, missing tests, documentation, small mechanical refactors.

Not suitable for dogfooding: schema migrations, engine/orchestrator changes, `CLAUDE.md` edits, or anything touching `ops/git-hooks/`.

Full operating procedure: [docs/superpowers/specs/2026-04-28-flx-9-dogfooding-design.md](superpowers/specs/2026-04-28-flx-9-dogfooding-design.md).

---

## Further Reading

- **[docs/session-quick-start.md](session-quick-start.md)** — conventions, env vars, database access, dev server port, autonomy rules. Read this first every session.
- **[CLAUDE.md](../CLAUDE.md)** — full command reference, architecture map, env var definitions, hook details.
- **[docs/superpowers/specs/2026-04-28-flx-9-dogfooding-design.md](superpowers/specs/2026-04-28-flx-9-dogfooding-design.md)** — dogfooding design, trust boundary, and operating procedure.
