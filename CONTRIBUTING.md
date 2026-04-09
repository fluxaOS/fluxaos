# Contributing to fluxaOS

Thank you for your interest in contributing to fluxaOS. This guide covers the basics of setting up a development environment and submitting changes.

## Prerequisites

- **Node.js 22+**
- **Docker** and **Docker Compose** (for Postgres and Redis)
- **Git**

## Setup

```bash
# Clone the repo
git clone https://github.com/fluxaOS/fluxaos.git
cd fluxaos

# Install dependencies
npm install

# Copy environment template
cp .env.example .env
# Edit .env with your credentials (Supabase, AI provider keys, etc.)

# Start infrastructure
docker compose up -d

# Run database migrations
npm run db:migrate

# Seed default data
npm run db:seed

# Start dev server
npm run dev
```

The app will be available at `http://localhost:3000`.

## Development workflow

1. **Create a branch** from `main`:
   ```bash
   git checkout -b your-feature-name
   ```

2. **Make your changes.** Follow the existing code patterns and structure.

3. **Run checks** before committing:
   ```bash
   npx vitest run        # Tests
   npx tsc --noEmit      # Type checking
   npx biome check .     # Lint + format
   ```

4. **Commit** with a clear message describing the change.

5. **Open a pull request** against `main`. Fill in the PR template.

## Code style

- **Formatter/linter:** [Biome](https://biomejs.dev/) handles formatting and linting. Run `npx biome check --write .` to auto-fix.
- **Indentation:** 2 spaces.
- **Quotes:** Single quotes for JavaScript/TypeScript.
- **Trailing commas:** ES5 style.
- **No `eslint-disable` or `biome-ignore`** without a comment explaining why.

## Project structure

```
src/
  adapters/       # External service integrations (Supabase, GitHub, BullMQ, etc.)
  app/            # Next.js App Router pages
  cli/            # CLI entry point and commands
  components/     # Shared React components
  config/         # Adapter registry and configuration
  core/           # Business logic (issues, personas, pipeline, gates, routing, etc.)
  lib/            # Shared utilities (tRPC client, providers)
  server/         # tRPC server and routers
```

See the [README](README.md) for architecture details.

## Tests

Tests live in `src/__tests__/` and use [Vitest](https://vitest.dev/). The test suite avoids requiring a live database — core logic is tested with mocks or pure functions.

```bash
npx vitest run              # Run all tests once
npx vitest                  # Watch mode
npx vitest run src/__tests__/e2e  # Run E2E tests only
```

## License

By contributing, you agree that your contributions will be licensed under the [AGPLv3](LICENSE).
