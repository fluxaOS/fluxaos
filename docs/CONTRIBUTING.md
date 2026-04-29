# Contributing to fluxaOS

## How to File an Issue

1. Check [Linear](https://linear.app) (team `FLX`) for existing issues before opening a new one.
2. Use the appropriate template: **bug report** or **feature request**.
3. Include reproduction steps for bugs; include motivation and acceptance criteria for features.
4. Tag the issue with the relevant area (`engine`, `ui`, `adapters`, etc.).

## How to Submit a PR

1. Branch off `main` using the convention `flx-NNN-short-slug` (e.g. `flx-42-fix-realtime-leak`).
2. Keep PRs focused — one logical change per PR.
3. Include `Fixes FLX-NNN` or `Refs FLX-NNN` in the commit body.
4. All checks must be green before requesting review:
   - `npm run lint` — no ESLint errors
   - `npx vitest` — integration tests pass (requires Supabase env vars)
   - `npm run build` — production build succeeds
5. Direct pushes to `main` are blocked; open a PR and merge via GitHub.

## Local Dev Setup

### Prerequisites

- Node.js 20+, npm 10+
- A Supabase Cloud project (free tier works)
- Redis (for BullMQ)

### Steps

```bash
git clone <repo-url>
cd fluxaos
npm install
cp .env.example .env.local   # fill in Supabase + Redis credentials
npm run db:migrate
npm run db:seed
npm run dev                  # starts on port 3003
```

See [Session Quick-Start](session-quick-start.md) for the full environment variable reference and common gotchas.
