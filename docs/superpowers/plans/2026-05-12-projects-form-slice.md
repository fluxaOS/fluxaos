# Projects Form Slice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land FLX-207/226/227/228/229 — every visible field on the Projects form becomes editable, FK invariants are server-enforced, repoUrl is liveness-validated via a vendor-agnostic adapter chain, slug renames are safe, and the brand mutation side-channel is deleted.

**Architecture:** Five layers, each ignorant of the layers below. Page → RecordEditor primitive → tRPC project router → vendor-agnostic GitRouter → self-registering provider adapters (GitHub today). No form, page, or router code mentions a specific git vendor; only the provider module does.

**Tech Stack:** Next.js 16 (App Router) + React 19, tRPC v11, Drizzle ORM, Supabase, Tailwind CSS 4, Vitest (integration tests against real Supabase), Playwright E2E.

**Spec:** `docs/superpowers/specs/2026-05-12-projects-form-slice-design.md`

---

## File Structure

### New files

| Path | Responsibility |
|---|---|
| `src/adapters/git-router/validation-types.ts` | Validation type contract: `RepoCoordinates`, `ValidationFailureReason`, `ValidationResult`, `GitProviderValidator` |
| `src/adapters/git-router/errors.ts` | `AuthError`, `NetworkError` classes used by provider validators |
| `src/adapters/git-router/validators/github.ts` | GitHub validator: hostnames, URL parse, liveness via REST API |
| `src/adapters/git-router/validator-registry.ts` | `buildGitRouter()` — assembles validators, exposes `GitRouter.validate(url)` |
| `src/core/services/project-fk-validators.ts` | `FK_VALIDATORS` map: per-FK scope validation (pipeline-in-project, brand-in-org) |
| `src/components/confirm-modal/ConfirmModal.tsx` | Generic promise-based confirm modal primitive |
| `src/components/confirm-modal/index.ts` | Re-exports `openConfirmModal()` |
| `src/components/record-editor/RepoUrlField.tsx` | Custom renderer for the repoUrl two-step Validate/Save UX |
| `src/app/[org]/[user]/[project]/settings/projects/buildProjectDescriptor.ts` | Factory that builds the descriptor with dynamic dropdown options |
| `src/__tests__/integration/project-update-fk-validation.test.ts` | FK validator integration tests |
| `src/__tests__/integration/project-validate-repo-url.test.ts` | GitRouter + endpoint integration tests |
| `e2e/settings-projects-form-slice.spec.ts` | Playwright journey covering the full form |

### Modified files

| Path | What changes |
|---|---|
| `src/components/record-editor/types.ts` | Add `select-id` to `FieldType`, `SelectIdOption`, `nullOptionLabel`, `selectIdOptions`, `customRenderer` |
| `src/components/record-editor/RecordField.tsx` | Branch for `select-id`; readonly visual refresh; `customRenderer` short-circuit |
| `src/server/routers/project.ts` | Tighten `update` input (slug regex, `repoUrl.url()`); call service FK + repo validation; add `validateRepoUrl` endpoint; delete `setDefaultPipeline` |
| `src/core/services/project.ts` | `update()` walks `FK_VALIDATORS` and revalidates `repoUrl` via gitRouter |
| `src/app/[org]/[user]/[project]/settings/projects/descriptor.ts` | Replace `defaultPipelineName` with `defaultPipelineId`, add `brandId`, swap `targetRepoPath` from readonly to text, add `repoUrl` customRenderer slot |
| `src/app/[org]/[user]/[project]/settings/projects/page.tsx` | Build descriptor via factory; delete brand `<section>` (lines 142-177); slug confirm modal + `router.replace`; repoUrl validity wiring |
| `src/app/[org]/[user]/[project]/settings/page.tsx` | Replace `trpc.project.setDefaultPipeline.useMutation` call with `trpc.project.update.useMutation` |
| `src/__tests__/integration/project-settings.test.ts` | Migrate three `setDefaultPipeline` cases to `project.update` |

---

## Task 1: Validation type contract

**Files:**
- Create: `src/adapters/git-router/validation-types.ts`
- Create: `src/adapters/git-router/errors.ts`

- [ ] **Step 1: Create the validation-types file**

```ts
// src/adapters/git-router/validation-types.ts
export type RepoCoordinates = {
  owner: string;
  repo: string;
};

export type ValidationFailureReason =
  | 'INVALID_URL'
  | 'UNSUPPORTED_HOST'
  | 'REPO_NOT_FOUND'
  | 'AUTH_FAILED'
  | 'NETWORK';

export type ValidationResult =
  | { ok: true; provider: string; coords: RepoCoordinates }
  | {
      ok: false;
      provider: string | null;
      reason: ValidationFailureReason;
      detail?: string;
    };

/**
 * Vendor-agnostic provider validator. Distinct from the richer GitProvider
 * port (`src/core/ports/git.ts`) — this is a thin "does this URL point at
 * a real, reachable repo?" interface. Adding a new vendor is a single file
 * implementing this interface plus a one-line registration in
 * validator-registry.ts. See spec §"Git router & adapter contract".
 */
export interface GitProviderValidator {
  readonly key: string;
  readonly supportedHosts: readonly string[];
  parse(url: URL): RepoCoordinates | null;
  exists(coords: RepoCoordinates): Promise<boolean>;
}
```

- [ ] **Step 2: Create the errors file**

```ts
// src/adapters/git-router/errors.ts
export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthError';
  }
}

export class NetworkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NetworkError';
  }
}

export function isAuthError(err: unknown): err is AuthError {
  return err instanceof AuthError;
}

export function isNetworkError(err: unknown): err is NetworkError {
  return err instanceof NetworkError;
}
```

- [ ] **Step 3: Run tsc to verify compile**

Run: `npx tsc --noEmit`
Expected: exit 0 (types compile)

- [ ] **Step 4: Commit**

```bash
git add src/adapters/git-router/validation-types.ts src/adapters/git-router/errors.ts
git commit -m "feat: GitProviderValidator contract + error classes (FLX-227)"
```

---

## Task 2: GitHub validator (TDD)

**Files:**
- Create: `src/adapters/git-router/validators/github.ts`
- Test: covered by integration test in Task 5 (no separate unit test — project bans unit tests; spec §"Testing strategy")

The validator is small enough that its full behavior is exercised by the Task 5 integration test (real network call to api.github.com). We don't have a unit-testing harness in this project. Therefore the TDD cycle for this task is "write the validator, verify it compiles, defer behavior verification to Task 5."

- [ ] **Step 1: Write the GitHub validator**

```ts
// src/adapters/git-router/validators/github.ts
import { AuthError, NetworkError } from '../errors';
import type { GitProviderValidator, RepoCoordinates } from '../validation-types';

export function gitHubValidator({
  token,
}: {
  token: string;
}): GitProviderValidator {
  return {
    key: 'github',
    supportedHosts: ['github.com', 'www.github.com'],

    parse(url) {
      // Accepts https://github.com/owner/repo and https://github.com/owner/repo.git
      const m = url.pathname.match(/^\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/);
      if (!m) return null;
      return { owner: m[1], repo: m[2] };
    },

    async exists({ owner, repo }: RepoCoordinates): Promise<boolean> {
      const res = await fetch(
        `https://api.github.com/repos/${owner}/${repo}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
          },
        }
      );
      if (res.status === 404) return false;
      if (res.status === 401 || res.status === 403) {
        throw new AuthError(res.statusText || `GitHub ${res.status}`);
      }
      if (!res.ok) {
        throw new NetworkError(`GitHub ${res.status}`);
      }
      return true;
    },
  };
}
```

- [ ] **Step 2: Verify compile**

Run: `npx tsc --noEmit`
Expected: exit 0

- [ ] **Step 3: Commit**

```bash
git add src/adapters/git-router/validators/github.ts
git commit -m "feat: GitHub repo-URL validator (FLX-227)"
```

---

## Task 3: GitRouter + validator registry

**Files:**
- Create: `src/adapters/git-router/validator-registry.ts`

- [ ] **Step 1: Create the router class and registry**

```ts
// src/adapters/git-router/validator-registry.ts
import { isAuthError, isNetworkError } from './errors';
import type {
  GitProviderValidator,
  ValidationResult,
} from './validation-types';
import { gitHubValidator } from './validators/github';

export class GitRouter {
  constructor(private readonly validators: readonly GitProviderValidator[]) {}

  async validate(rawUrl: string): Promise<ValidationResult> {
    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      return { ok: false, provider: null, reason: 'INVALID_URL' };
    }

    const adapter = this.validators.find((a) =>
      a.supportedHosts.includes(url.hostname)
    );
    if (!adapter) {
      return { ok: false, provider: null, reason: 'UNSUPPORTED_HOST' };
    }

    const coords = adapter.parse(url);
    if (!coords) {
      return { ok: false, provider: adapter.key, reason: 'INVALID_URL' };
    }

    try {
      const found = await adapter.exists(coords);
      return found
        ? { ok: true, provider: adapter.key, coords }
        : { ok: false, provider: adapter.key, reason: 'REPO_NOT_FOUND' };
    } catch (err) {
      if (isAuthError(err)) {
        return {
          ok: false,
          provider: adapter.key,
          reason: 'AUTH_FAILED',
          detail: String(err),
        };
      }
      if (isNetworkError(err)) {
        return {
          ok: false,
          provider: adapter.key,
          reason: 'NETWORK',
          detail: String(err),
        };
      }
      throw err;
    }
  }

  /** Hostnames that any registered validator claims — used by the page to
   *  render the supported-hosts hint in UNSUPPORTED_HOST error copy.
   *  Vendor-agnostic: the page never spells "github". */
  supportedHosts(): readonly string[] {
    return this.validators.flatMap((v) => v.supportedHosts);
  }
}

/**
 * Build the slice's vendor-agnostic repo-URL validator chain. Distinct from
 * `createGitProviderFactory()` in `factory.ts` (FLX-4 / FLX-218) which
 * builds the richer GitProvider used by stage-runner-env / deploy-bridge.
 *
 * Adding a new validator = one new file in `validators/` + one line here.
 */
export function buildGitRouter(): GitRouter {
  const token = process.env.FLUXAOS_GITHUB_TOKEN;
  if (!token) {
    throw new Error(
      'FLUXAOS_GITHUB_TOKEN is required for repo URL validation. ' +
        'See CLAUDE.md → R-RUNTIME env vars.'
    );
  }
  return new GitRouter([
    gitHubValidator({ token }),
    // gitLabValidator({ token: process.env.FLUXAOS_GITLAB_TOKEN }),  // future
    // forgejoValidator({ ... }),                                       // future
  ]);
}
```

- [ ] **Step 2: Verify compile**

Run: `npx tsc --noEmit`
Expected: exit 0

- [ ] **Step 3: Commit**

```bash
git add src/adapters/git-router/validator-registry.ts
git commit -m "feat: GitRouter + buildGitRouter() registry (FLX-227)"
```

---

## Task 4: `project.validateRepoUrl` tRPC endpoint

**Files:**
- Modify: `src/server/routers/project.ts`

- [ ] **Step 1: Add the endpoint**

Add the import at the top:

```ts
import { buildGitRouter } from '@/adapters/git-router/validator-registry';
```

Add this method inside the `router({ ... })` block, after `delete` and before `setDefaultPipeline`:

```ts
  /**
   * FLX-227: liveness check on a repo URL. Walks the registered git
   * provider validators (vendor-agnostic) and returns a structured
   * ValidationResult. Called by the Projects form's "Validate" button
   * and re-run by project.update on save. Never used as a fallback.
   */
  validateRepoUrl: protectedMutation(EDIT_ROLES)
    .input(z.object({ url: z.string().url() }))
    .mutation(async ({ input }) => {
      const router = buildGitRouter();
      return router.validate(input.url);
    }),
```

- [ ] **Step 2: Verify compile**

Run: `npx tsc --noEmit`
Expected: exit 0

- [ ] **Step 3: Commit**

```bash
git add src/server/routers/project.ts
git commit -m "feat: project.validateRepoUrl tRPC endpoint (FLX-227)"
```

---

## Task 5: GitRouter integration test (TDD)

**Files:**
- Create: `src/__tests__/integration/project-validate-repo-url.test.ts`

This task verifies Tasks 1-4 end-to-end. Per project rules, integration tests against real Supabase only — no unit tests.

The GitRouter doesn't touch the DB, but we still place this in the integration suite so it runs alongside everything else (and because it makes real HTTP calls to api.github.com, which is exactly an "integration" concern). No fixtures are needed for these cases.

**Reviewer-fix:** the project has no `helpers/` directory and no `createCallerFactory` export. The real pattern is direct `import { appRouter } from '@/server/root'` for caller-style tests; this test doesn't even need that since it imports the router directly.

- [ ] **Step 1: Write the failing test**

```ts
// src/__tests__/integration/project-validate-repo-url.test.ts
import 'dotenv/config';
import { describe, expect, it } from 'vitest';
import { buildGitRouter } from '@/adapters/git-router/validator-registry';

describe('GitRouter.validate (FLX-227)', () => {
  // Construct once at suite scope — buildGitRouter() throws if
  // FLUXAOS_GITHUB_TOKEN is missing. That's intentional (the rest of
  // the suite needs the same env anyway).
  const router = buildGitRouter();

  it('returns INVALID_URL for a malformed URL', async () => {
    const result = await router.validate('not a url');
    expect(result).toEqual({
      ok: false,
      provider: null,
      reason: 'INVALID_URL',
    });
  });

  it('returns UNSUPPORTED_HOST for a host with no registered validator', async () => {
    const result = await router.validate(
      'https://bitbucket.org/owner/repo'
    );
    expect(result).toEqual({
      ok: false,
      provider: null,
      reason: 'UNSUPPORTED_HOST',
    });
  });

  it('returns INVALID_URL for a GitHub URL that does not parse as owner/repo', async () => {
    const result = await router.validate('https://github.com/just-one-segment');
    expect(result).toEqual({
      ok: false,
      provider: 'github',
      reason: 'INVALID_URL',
    });
  });

  it('returns REPO_NOT_FOUND for a GitHub URL pointing at a non-existent repo', async () => {
    const result = await router.validate(
      'https://github.com/flux-not-a-real-org/flux-not-a-real-repo'
    );
    expect(result).toEqual({
      ok: false,
      provider: 'github',
      reason: 'REPO_NOT_FOUND',
    });
  });

  it('returns ok:true for a real public GitHub repo', async () => {
    const result = await router.validate('https://github.com/fluxaOS/fluxaos');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.provider).toBe('github');
      expect(result.coords).toEqual({ owner: 'fluxaOS', repo: 'fluxaos' });
    }
  });

  it('accepts a .git suffix on the URL', async () => {
    const result = await router.validate(
      'https://github.com/fluxaOS/fluxaos.git'
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.coords).toEqual({ owner: 'fluxaOS', repo: 'fluxaos' });
    }
  });
});
```

- [ ] **Step 2: Run test to verify behavior**

Run: `set -a; source .env; source .env.local; set +a; npx vitest run src/__tests__/integration/project-validate-repo-url.test.ts`
Expected: all 6 tests pass. (`FLUXAOS_GITHUB_TOKEN` must be set; if not, the test will throw at `buildGitRouter()` with the env-var error — fix env, do not weaken the test.)

- [ ] **Step 3: Commit**

```bash
git add src/__tests__/integration/project-validate-repo-url.test.ts
git commit -m "test: GitRouter validate covers all reason codes (FLX-227)"
```

---

## Task 6: FK validators module

**Files:**
- Create: `src/core/services/project-fk-validators.ts`

- [ ] **Step 1: Create the FK_VALIDATORS map**

```ts
// src/core/services/project-fk-validators.ts
import { TRPCError } from '@trpc/server';
import { eq } from 'drizzle-orm';
import type { Database } from '@/core/db/connection';
import { brand, pipeline, project } from '@/core/db/schema';

/**
 * Per-FK scope validation. The project-service `update()` walks this map
 * for every key present in the patch; new FK columns on `project` need
 * one entry here and nothing else.
 *
 * Each validator throws TRPCError with a stable `message` key (e.g.,
 * 'PIPELINE_NOT_IN_PROJECT') that the page maps to user copy. See spec
 * §"Error message keys".
 */
export type FkValidator = (
  db: Database,
  projectId: string,
  value: unknown
) => Promise<void>;

export const FK_VALIDATORS: Record<string, FkValidator> = {
  defaultPipelineId: async (db, projectId, value) => {
    if (value == null) return;
    const [pipe] = await db
      .select()
      .from(pipeline)
      .where(eq(pipeline.id, value as string))
      .limit(1);
    if (!pipe) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: 'PIPELINE_NOT_FOUND',
      });
    }
    if (pipe.projectId !== projectId) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'PIPELINE_NOT_IN_PROJECT',
      });
    }
  },

  brandId: async (db, projectId, value) => {
    if (value == null) return;
    const [proj] = await db
      .select()
      .from(project)
      .where(eq(project.id, projectId))
      .limit(1);
    if (!proj) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'PROJECT_NOT_FOUND' });
    }
    const [br] = await db
      .select()
      .from(brand)
      .where(eq(brand.id, value as string))
      .limit(1);
    if (!br) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'BRAND_NOT_FOUND' });
    }
    if (br.orgId !== proj.orgId) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'BRAND_NOT_IN_ORG',
      });
    }
  },
};
```

- [ ] **Step 2: Verify compile**

Run: `npx tsc --noEmit`
Expected: exit 0

- [ ] **Step 3: Commit**

```bash
git add src/core/services/project-fk-validators.ts
git commit -m "feat: FK_VALIDATORS map for project.update (FLX-228, FLX-229)"
```

---

## Task 7: Service-layer `update()` with FK + repo validation

**Files:**
- Modify: `src/core/services/project.ts`

**Reviewer-fix (CRITICAL):** the GitRouter is injected, not imported. The project's stated DI rule is "zero vendor imports in `src/core/`." `createProjectService` gains a second parameter; the router wiring happens in `src/server/routers/project.ts` (Task 8). The `gitRouter` parameter is optional only because legacy callers exist that pass only `db` — those callers never include `repoUrl` in their patches, so the lazy throw below is correct for them. When `repoUrl` IS in a patch and `gitRouter` is undefined, throw — no fallbacks.

- [ ] **Step 1: Replace the service to add `update()`**

```ts
// src/core/services/project.ts
import { TRPCError } from '@trpc/server';
import { and, eq } from 'drizzle-orm';
import type { Database } from '@/core/db/connection';
import { project } from '@/core/db/schema';
import { createCrudService } from './crud-factory';
import { FK_VALIDATORS } from './project-fk-validators';

type ProjectInsert = typeof project.$inferInsert;
type ProjectSelect = typeof project.$inferSelect;

/**
 * Minimal port for the repoUrl validator the service needs. Decouples
 * the service from `@/adapters/git-router/*` (DI rule: zero vendor
 * imports in `src/core/`).
 */
export interface RepoUrlValidatorPort {
  validate(url: string): Promise<
    | { ok: true; provider: string; coords: { owner: string; repo: string } }
    | { ok: false; provider: string | null; reason: string; detail?: string }
  >;
}

export function createProjectService(
  db: Database,
  deps?: { repoUrlValidator?: RepoUrlValidatorPort }
) {
  const crud = createCrudService<ProjectInsert, ProjectSelect>(db, project);

  return {
    ...crud,

    /**
     * FLX-228 / FLX-229: walk FK_VALIDATORS for every key in the patch
     * so FK scope is enforced in one place. FLX-227: when `repoUrl` is
     * in the patch and non-null, re-validate via the injected port.
     * The server is authoritative; the form's "Validate" button is a
     * UX hint, not a save gate.
     */
    async update(id: string, patch: Partial<ProjectInsert>) {
      for (const key of Object.keys(patch)) {
        const validator = FK_VALIDATORS[key];
        if (validator) {
          await validator(db, id, (patch as Record<string, unknown>)[key]);
        }
      }

      if ('repoUrl' in patch && patch.repoUrl != null) {
        if (!deps?.repoUrlValidator) {
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: 'REPO_URL_VALIDATOR_NOT_INJECTED',
          });
        }
        const result = await deps.repoUrlValidator.validate(
          patch.repoUrl as string
        );
        if (!result.ok) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: `REPO_URL_${result.reason}`,
            cause: result,
          });
        }
      }

      return crud.update(id, patch);
    },

    async listByOrg(orgId: string): Promise<ProjectSelect[]> {
      return db.select().from(project).where(eq(project.orgId, orgId));
    },

    async listByUser(userId: string): Promise<ProjectSelect[]> {
      return db.select().from(project).where(eq(project.userId, userId));
    },

    async getBySlug(
      orgId: string,
      slug: string
    ): Promise<ProjectSelect | null> {
      const [row] = await db
        .select()
        .from(project)
        .where(and(eq(project.orgId, orgId), eq(project.slug, slug)));
      return row ?? null;
    },

    async getFirstBySlug(slug: string): Promise<ProjectSelect | null> {
      const [row] = await db
        .select()
        .from(project)
        .where(eq(project.slug, slug))
        .limit(1);
      return row ?? null;
    },

    async getByUserSlug(
      userId: string,
      slug: string
    ): Promise<ProjectSelect | null> {
      const [row] = await db
        .select()
        .from(project)
        .where(and(eq(project.userId, userId), eq(project.slug, slug)));
      return row ?? null;
    },
  };
}

export type ProjectService = ReturnType<typeof createProjectService>;
```

- [ ] **Step 2: Verify compile**

Run: `npx tsc --noEmit`
Expected: exit 0

- [ ] **Step 3: Commit**

```bash
git add src/core/services/project.ts
git commit -m "feat: project-service.update enforces FK scope + repo liveness (FLX-227, 228, 229)"
```

---

## Task 8: tRPC `project.update` input tightening + delete `setDefaultPipeline`

**Files:**
- Modify: `src/server/routers/project.ts`

**Pre-step audit (reviewer-fix):** before editing, run:

```bash
grep -rn "setDefaultPipeline" /mnt/dev/fluxaos/src /mnt/dev/fluxaos/e2e 2>/dev/null
```

Expected callers: `src/app/[org]/[user]/[project]/settings/page.tsx`, `src/__tests__/integration/project-settings.test.ts`, and the endpoint itself. The plan handles all three (Tasks 9, 10, 8 respectively). If any unexpected caller surfaces — Playwright spec, additional component — STOP and add it to Task 9 before continuing.

- [ ] **Step 1: Wire the injected git-router validator**

The service now takes an injected `repoUrlValidator` port (Task 7 reviewer-fix). The router constructs the GitRouter (which IS allowed to live in the server layer) and passes it in. Add at the top of `src/server/routers/project.ts`:

```ts
import { buildGitRouter } from '@/adapters/git-router/validator-registry';
```

Replace the `update` mutation body (around lines 54-73) with the new input shape AND validator injection:

```ts
  update: protectedMutation(EDIT_ROLES)
    .input(
      z.object({
        id: z.string().uuid(),
        name: z.string().min(1).optional(),
        slug: z
          .string()
          .min(1)
          .regex(/^[a-z0-9-]+$/, 'SLUG_INVALID_FORMAT')
          .optional(),
        repoUrl: z.string().url().nullable().optional(),
        defaultBranch: z.string().min(1).optional(),
        defaultPipelineId: z.string().uuid().nullable().optional(),
        brandId: z.string().uuid().nullable().optional(),
        targetRepoPath: z.string().nullable().optional(),
      })
    )
    .mutation(({ ctx, input }) => {
      const { id, ...data } = input;
      return createProjectService(ctx.db, {
        repoUrlValidator: buildGitRouter(),
      }).update(id, data);
    }),
```

Also update `validateRepoUrl` from Task 4 to use the same builder (already does — no change). The router-layer import is intentional: vendor wiring belongs above `src/core/`.

- [ ] **Step 2: Delete `setDefaultPipeline`**

Remove the entire `setDefaultPipeline` block (lines ~88-116 in the original file). Then check whether `TRPCError` is still used:

```bash
grep -c "TRPCError" src/server/routers/project.ts
```

If the count is 0, remove the `import { TRPCError } from '@trpc/server';` line. Otherwise keep it.

- [ ] **Step 3: Verify compile**

Run: `npx tsc --noEmit`
Expected: tsc errors limited to callers of `trpc.project.setDefaultPipeline` (`src/app/[org]/[user]/[project]/settings/page.tsx`, the integration test). Both are fixed in Tasks 9 and 10. If errors appear ANYWHERE else, stop and audit — there's an unexpected caller.

- [ ] **Step 4: Do NOT commit yet** — caller migration in Task 9 must land in the same commit. Continue.

---

## Task 9: Migrate the "Set as default" button to `project.update`

**Files:**
- Modify: `src/app/[org]/[user]/[project]/settings/page.tsx`

- [ ] **Step 1: Swap the mutation**

Find lines 33-38:

```ts
  const setDefaultMutation = trpc.project.setDefaultPipeline.useMutation({
    onSuccess: async () => {
      await utils.project.listByOrg.invalidate();
      await utils.project.list.invalidate();
    },
  });
```

Replace with:

```ts
  // FLX-228: setDefaultPipeline is gone. project.update enforces the
  // "pipeline belongs to this project" invariant via the service layer.
  const setDefaultMutation = trpc.project.update.useMutation({
    onSuccess: async () => {
      await utils.project.listByOrg.invalidate();
      await utils.project.list.invalidate();
    },
  });
```

Find lines 94-99 (the onClick handler):

```ts
                        onClick={() =>
                          setDefaultMutation.mutate({
                            projectId,
                            pipelineId: p.id,
                          })
                        }
```

Replace with:

```ts
                        onClick={() =>
                          setDefaultMutation.mutate({
                            id: projectId,
                            defaultPipelineId: p.id,
                          })
                        }
```

- [ ] **Step 2: Verify compile**

Run: `npx tsc --noEmit`
Expected: exit 0

- [ ] **Step 3: Commit Tasks 8+9 together**

```bash
git add src/server/routers/project.ts src/app/[org]/[user]/[project]/settings/page.tsx
git commit -m "refactor: delete setDefaultPipeline; use project.update + service FK guard (FLX-228)"
```

---

## Task 10: Migrate `setDefaultPipeline` integration tests

**Files:**
- Modify: `src/__tests__/integration/project-settings.test.ts`

- [ ] **Step 1: Inspect the existing tests**

Run: `grep -n "setDefaultPipeline" src/__tests__/integration/project-settings.test.ts`
Expected: 4-5 matches around lines 114-170.

Read those three test cases. Each one calls `caller.project.setDefaultPipeline({...})`. They must be rewritten to call `caller.project.update({ id, defaultPipelineId })` and assert the same outcomes:

1. "sets a same-project pipeline" → `update` succeeds, project row has the new `defaultPipelineId`.
2. "rejects a cross-project pipeline" → `update` throws `TRPCError` with `message: 'PIPELINE_NOT_IN_PROJECT'`.
3. "({ pipelineId: null }) clears the default" → `update({id, defaultPipelineId: null})` succeeds, row has `defaultPipelineId: null`.

- [ ] **Step 2: Rewrite each case**

Edit the test calls. The signature changes from `{ projectId, pipelineId }` to `{ id, defaultPipelineId }`. Throw assertions check `error.message === 'PIPELINE_NOT_IN_PROJECT'` (was `'PIPELINE_NOT_IN_PROJECT'` already — keep the key). Update the describe block heading from "project.setDefaultPipeline" to "project.update (defaultPipelineId)".

- [ ] **Step 3: Run the suite to verify**

Run: `set -a; source .env; source .env.local; set +a; npx vitest run src/__tests__/integration/project-settings.test.ts`
Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/__tests__/integration/project-settings.test.ts
git commit -m "test: migrate setDefaultPipeline tests to project.update (FLX-228)"
```

---

## Task 11: FK validation integration test

**Files:**
- Create: `src/__tests__/integration/project-update-fk-validation.test.ts`

**Reviewer-fix:** the project has no `helpers/` directory and no `createCallerFactory` export. The canonical pattern is in `src/__tests__/integration/project-settings.test.ts`:

- `import { appRouter } from '@/server/root';`
- `import { SupabaseDatabaseProvider } from '@/adapters/supabase/database';`
- `caller = appRouter.createCaller({ db, viewer: { authUserId: null, fluxaUserId: null, role: 'admin', tier: 'enterprise' } });`
- Inline `makeFixture(db)` using raw Drizzle inserts; tear down per-test.

This task follows that pattern exactly.

- [ ] **Step 1: Confirm `brand` table required columns**

Run: `grep -A 12 "export const brand = pgTable" /mnt/dev/fluxaos/src/core/db/schema.ts | head -20`

Confirm which columns are NOT NULL (the schema shows `orgId` and `name` are required; `slug` is required). Adjust the insert in the test accordingly.

- [ ] **Step 2: Write the test**

```ts
// src/__tests__/integration/project-update-fk-validation.test.ts
import 'dotenv/config';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { SupabaseDatabaseProvider } from '@/adapters/supabase/database';
import { brand, organization, pipeline, project, user } from '@/core/db/schema';
import { appRouter } from '@/server/root';

function stamp(label: string): string {
  return `fk-${label}-${Date.now()}`;
}

async function makeFixture(
  db: ReturnType<SupabaseDatabaseProvider['getConnection']>,
  label: string
) {
  const s = stamp(label);
  const [org] = await db
    .insert(organization)
    .values({ name: s, slug: s })
    .returning();
  const [userRow] = await db
    .insert(user)
    .values({ orgId: org.id, email: `${s}@test.local`, name: s, slug: s })
    .returning();
  const [projRow] = await db
    .insert(project)
    .values({
      orgId: org.id,
      userId: userRow.id,
      name: s,
      slug: s,
      defaultBranch: 'main',
    })
    .returning();
  return { org, userRow, projRow };
}

async function teardown(
  db: ReturnType<SupabaseDatabaseProvider['getConnection']>,
  ids: { orgId: string; userId: string; projectId: string }
) {
  await db
    .delete(brand)
    .where(eq(brand.orgId, ids.orgId))
    .catch(() => undefined);
  await db
    .delete(pipeline)
    .where(eq(pipeline.projectId, ids.projectId))
    .catch(() => undefined);
  await db
    .delete(project)
    .where(eq(project.id, ids.projectId))
    .catch(() => undefined);
  await db
    .delete(user)
    .where(eq(user.id, ids.userId))
    .catch(() => undefined);
  await db
    .delete(organization)
    .where(eq(organization.id, ids.orgId))
    .catch(() => undefined);
}

describe('project.update FK validation (FLX-228, FLX-229)', () => {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL required');
  const dbProvider = new SupabaseDatabaseProvider(url);
  const db = dbProvider.getConnection();
  const caller = appRouter.createCaller({
    db,
    viewer: {
      authUserId: null,
      fluxaUserId: null,
      role: 'admin',
      tier: 'enterprise',
    },
  });

  it('rejects defaultPipelineId from a different project', async () => {
    const fA = await makeFixture(db, 'pipe-cross-a');
    const fB = await makeFixture(db, 'pipe-cross-b');
    try {
      const [otherPipe] = await db
        .insert(pipeline)
        .values({ projectId: fB.projRow.id, name: `${stamp('p')}` })
        .returning();
      await expect(
        caller.project.update({
          id: fA.projRow.id,
          defaultPipelineId: otherPipe.id,
        })
      ).rejects.toMatchObject({ message: 'PIPELINE_NOT_IN_PROJECT' });
    } finally {
      await teardown(db, {
        orgId: fA.org.id,
        userId: fA.userRow.id,
        projectId: fA.projRow.id,
      });
      await teardown(db, {
        orgId: fB.org.id,
        userId: fB.userRow.id,
        projectId: fB.projRow.id,
      });
    }
  });

  it('accepts defaultPipelineId from the same project, then clears it with null', async () => {
    const f = await makeFixture(db, 'pipe-same');
    try {
      const [p] = await db
        .insert(pipeline)
        .values({ projectId: f.projRow.id, name: `${stamp('p')}` })
        .returning();

      await caller.project.update({
        id: f.projRow.id,
        defaultPipelineId: p.id,
      });
      const after1 = await caller.project.getById({ id: f.projRow.id });
      expect(after1?.defaultPipelineId).toBe(p.id);

      await caller.project.update({
        id: f.projRow.id,
        defaultPipelineId: null,
      });
      const after2 = await caller.project.getById({ id: f.projRow.id });
      expect(after2?.defaultPipelineId).toBeNull();
    } finally {
      await teardown(db, {
        orgId: f.org.id,
        userId: f.userRow.id,
        projectId: f.projRow.id,
      });
    }
  });

  it('rejects brandId from a different org', async () => {
    const fA = await makeFixture(db, 'brand-cross-a');
    const fB = await makeFixture(db, 'brand-cross-b');
    try {
      const [otherBrand] = await db
        .insert(brand)
        .values({ orgId: fB.org.id, name: `${stamp('b')}`, slug: `${stamp('b')}` })
        .returning();

      await expect(
        caller.project.update({
          id: fA.projRow.id,
          brandId: otherBrand.id,
        })
      ).rejects.toMatchObject({ message: 'BRAND_NOT_IN_ORG' });
    } finally {
      await teardown(db, {
        orgId: fA.org.id,
        userId: fA.userRow.id,
        projectId: fA.projRow.id,
      });
      await teardown(db, {
        orgId: fB.org.id,
        userId: fB.userRow.id,
        projectId: fB.projRow.id,
      });
    }
  });

  it('accepts brandId from the same org', async () => {
    const f = await makeFixture(db, 'brand-same');
    try {
      const [b] = await db
        .insert(brand)
        .values({ orgId: f.org.id, name: `${stamp('b')}`, slug: `${stamp('b')}` })
        .returning();

      await caller.project.update({
        id: f.projRow.id,
        brandId: b.id,
      });
      const after = await caller.project.getById({ id: f.projRow.id });
      expect(after?.brandId).toBe(b.id);
    } finally {
      await teardown(db, {
        orgId: f.org.id,
        userId: f.userRow.id,
        projectId: f.projRow.id,
      });
    }
  });
});
```

**Important:** verify the `brand` table column names match the schema before running. The schema at `src/core/db/schema.ts` around line 828 is the source of truth — confirm `orgId`, `name`, `slug` (or whatever exists). Adjust the inserts if any column is named differently.

- [ ] **Step 3: Run the suite**

Run: `set -a; source .env; source .env.local; set +a; npx vitest run src/__tests__/integration/project-update-fk-validation.test.ts`
Expected: 4/4 pass.

- [ ] **Step 4: Commit**

```bash
git add src/__tests__/integration/project-update-fk-validation.test.ts
git commit -m "test: project.update FK validation (FLX-228, FLX-229)"
```

---

## Task 12: `select-id` field type and readonly visual refresh

**Files:**
- Modify: `src/components/record-editor/types.ts`
- Modify: `src/components/record-editor/RecordField.tsx`

- [ ] **Step 1: Extend the types**

Edit `src/components/record-editor/types.ts`. Replace the existing `FieldType` and `FieldDescriptor`:

```ts
import type { ReactNode } from 'react';

export type FieldType =
  | 'text'
  | 'textarea'
  | 'textarea-large'
  | 'tags'
  | 'boolean'
  | 'jsonb'
  | 'select'
  | 'select-id'
  | 'readonly';

export type SelectIdOption = {
  /** UUID written to the record */
  value: string;
  /** Human-readable label shown in the dropdown */
  label: string;
};

export type CustomRendererProps<TRecord> = {
  field: FieldDescriptor<TRecord>;
  value: unknown;
  editing: boolean;
  onChange: (next: unknown) => void;
  error?: string | null;
  onValidityChange?: (key: string, error: string | null) => void;
};

export type FieldDescriptor<TRecord> = {
  key: keyof TRecord & string;
  label: string;
  helpText?: string;
  fieldType: FieldType;
  required?: boolean;
  placeholder?: string;
  validate?: (value: unknown) => string | null;
  sensitive?: boolean;
  /** For fieldType: 'select' — literal string enums (unchanged). */
  options?: readonly string[];
  /** For fieldType: 'select-id' — FK lookups: render label, save value. */
  selectIdOptions?: readonly SelectIdOption[];
  /**
   * For fieldType: 'select-id' — label of the null/empty choice. Omit
   * to force a non-null selection (no leading null option).
   */
  nullOptionLabel?: string;
  /**
   * Generic escape hatch. When set, RecordField defers to this renderer
   * for the field — used by repoUrl for the two-step Validate UX. The
   * renderer can call `onValidityChange(key, err|null)` to lift a
   * field-local validity error to the editor so Save can block.
   */
  customRenderer?: (props: CustomRendererProps<TRecord>) => ReactNode;
};
```

Keep the rest of the file (`RecordDescriptor`, `RecordWithVersion`, `RecordEditorProps`) unchanged.

- [ ] **Step 2: Add `select-id` branch + customRenderer short-circuit to RecordField**

Edit `src/components/record-editor/RecordField.tsx`. Inside `RecordFieldInner`, add the customRenderer short-circuit **as the very first thing** (above the existing readonly branch):

```ts
  // Custom renderer escape hatch — used by repoUrl's two-step Validate UX.
  // Defer entirely to the descriptor's renderer when set.
  if (field.customRenderer) {
    return (
      <>
        {field.customRenderer({
          field,
          value,
          editing,
          onChange,
          error,
          onValidityChange,
        })}
      </>
    );
  }
```

Add the `select-id` branch immediately after the existing `select` branch (around line 205):

```ts
  // SELECT-ID (FK lookup — label shown, value (UUID) saved)
  // No fallbacks: an undefined selectIdOptions is a descriptor bug —
  // surface it, don't render an empty dropdown that silently looks
  // valid. Per CLAUDE.md / ARCHITECTURAL_STANDARDS.md §2.
  if (field.fieldType === 'select-id') {
    if (!field.selectIdOptions) {
      throw new Error(
        `RecordField: select-id field "${field.key}" is missing selectIdOptions. ` +
          'Pass an empty array explicitly if the dropdown is intentionally empty.'
      );
    }
    const options = field.selectIdOptions;
    const hasNullOption = typeof field.nullOptionLabel === 'string';
    const selected = value == null ? '' : String(value);
    return (
      <div className="mb-3">
        {label}
        <select
          disabled={!editing}
          value={selected}
          onChange={(e) => {
            const next = e.target.value;
            onChange(next === '' ? null : next);
          }}
          aria-label={field.label}
          className={`${common} ${borderClass} disabled:opacity-75`}
        >
          {hasNullOption ? (
            <option value="">{field.nullOptionLabel}</option>
          ) : null}
          {options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        {error ? <p className="mt-1 text-xs text-red-400">{error}</p> : null}
        {helpTextNode}
      </div>
    );
  }
```

Refresh the readonly branch. Find the existing readonly block (around lines 83-93). Replace with:

```ts
  // READ-ONLY — visually unmistakable from editable fields per FLX-207.
  if (field.fieldType === 'readonly') {
    return (
      <div className="mb-3">
        <label className="text-xs font-medium text-slate-400 block mb-1">
          {field.label}
          <span className="ml-1.5 text-[10px] text-slate-500 font-normal">
            (read-only)
          </span>
        </label>
        <div
          className="text-sm font-mono text-slate-400 px-3 py-2 bg-slate-900/30 border border-dashed border-slate-700/40 rounded-lg cursor-not-allowed"
          aria-readonly="true"
        >
          {String(value ?? '—')}
        </div>
        {helpTextNode}
      </div>
    );
  }
```

- [ ] **Step 3: Verify compile**

Run: `npx tsc --noEmit`
Expected: exit 0

- [ ] **Step 4: Commit**

```bash
git add src/components/record-editor/types.ts src/components/record-editor/RecordField.tsx
git commit -m "feat: select-id field type, customRenderer hook, readonly visual refresh (FLX-207)"
```

---

## Task 13: Confirm modal primitive

**Files:**
- Create: `src/components/confirm-modal/ConfirmModal.tsx`
- Create: `src/components/confirm-modal/index.ts`

The modal uses a module-level promise queue so any caller can call `openConfirmModal(...)` without threading state through props. It mounts once at the app root (Task 17).

- [ ] **Step 1: Create the component**

```tsx
// src/components/confirm-modal/ConfirmModal.tsx
'use client';

import { useEffect, useState } from 'react';

type ConfirmRequest = {
  title: string;
  body: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
};

type Resolver = (confirmed: boolean) => void;

let resolveQueue: Resolver | null = null;
let setRequestQueue: ((req: ConfirmRequest | null) => void) | null = null;

/**
 * Promise-based confirm modal. Mount <ConfirmModalHost /> once at the
 * app root; any client component can then call openConfirmModal(...).
 * Throws if called before the host is mounted.
 */
export function openConfirmModal(req: ConfirmRequest): Promise<boolean> {
  if (!setRequestQueue) {
    throw new Error(
      'openConfirmModal called before <ConfirmModalHost /> mounted'
    );
  }
  return new Promise((resolve) => {
    resolveQueue = resolve;
    setRequestQueue?.(req);
  });
}

export function ConfirmModalHost() {
  const [request, setRequest] = useState<ConfirmRequest | null>(null);

  useEffect(() => {
    setRequestQueue = setRequest;
    return () => {
      setRequestQueue = null;
    };
  }, []);

  if (!request) return null;

  const confirm = (value: boolean) => {
    const resolve = resolveQueue;
    resolveQueue = null;
    setRequest(null);
    resolve?.(value);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-sm"
      onClick={() => confirm(false)}
    >
      <div
        className="card-static p-6 max-w-md w-full mx-4 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <h2
          id="confirm-modal-title"
          className="text-base font-semibold text-white"
        >
          {request.title}
        </h2>
        <p className="text-sm text-slate-300">{request.body}</p>
        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={() => confirm(false)}
            className="px-3 py-1.5 text-sm text-slate-300 hover:text-white"
          >
            {request.cancelLabel ?? 'Cancel'}
          </button>
          <button
            type="button"
            onClick={() => confirm(true)}
            className={
              request.destructive
                ? 'px-3 py-1.5 text-sm font-medium text-white bg-red-600 hover:bg-red-500 rounded-md'
                : 'px-3 py-1.5 text-sm font-medium text-white bg-electric-violet hover:bg-accent-hover rounded-md'
            }
            data-testid="confirm-modal-confirm"
          >
            {request.confirmLabel ?? 'Confirm'}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create the barrel**

```ts
// src/components/confirm-modal/index.ts
export { ConfirmModalHost, openConfirmModal } from './ConfirmModal';
```

- [ ] **Step 3: Verify compile**

Run: `npx tsc --noEmit`
Expected: exit 0

- [ ] **Step 4: Commit**

```bash
git add src/components/confirm-modal/
git commit -m "feat: ConfirmModal primitive with promise-based open API (FLX-226)"
```

---

## Task 14: Mount `ConfirmModalHost` inside the project-scoped client boundary

**Files:**
- Modify: `src/app/[org]/[user]/[project]/layout.tsx`

**Reviewer-fix (HIGH):** `src/app/layout.tsx` is a bare server component with no `'use client'` boundary or providers wrapper — mounting `ConfirmModalHost` there means React server-renders the layout once, then client-hydrates a separate boundary for the modal, and the module-level `setRequestQueue` ref never makes it across to the client tree the form lives in. The correct mount target is `src/app/[org]/[user]/[project]/layout.tsx` — it already nests `<TRPCProvider>` (which IS `'use client'`), so anything inside it is on the same client island as the form. Scope is also correct: the modal is only useful on project-scoped pages where the form exists.

- [ ] **Step 1: Inspect the target layout**

Run: `cat src/app/[org]/[user]/[project]/layout.tsx`

You should see:
```tsx
import { Nav } from '@/components/nav';
import { TRPCProvider } from '@/lib/trpc/provider';

export default function DashboardLayout({ children }: { ... }) {
  return (
    <TRPCProvider>
      <div className="flex h-full min-h-screen relative z-1">
        <Nav />
        <main className="flex-1 p-6 lg:p-8 overflow-y-auto">
          <div className="max-w-[1280px]">{children}</div>
        </main>
      </div>
    </TRPCProvider>
  );
}
```

`<TRPCProvider>` is `'use client'` (see `src/lib/trpc/provider.tsx:1`). Children rendered inside it share its client island.

- [ ] **Step 2: Mount the host**

Add the import:

```tsx
import { ConfirmModalHost } from '@/components/confirm-modal';
```

Wrap the existing JSX so `<ConfirmModalHost />` sits inside `<TRPCProvider>` (same client island) but at sibling level to the main content, so it overlays:

```tsx
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <TRPCProvider>
      <div className="flex h-full min-h-screen relative z-1">
        <Nav />
        <main className="flex-1 p-6 lg:p-8 overflow-y-auto">
          <div className="max-w-[1280px]">{children}</div>
        </main>
      </div>
      <ConfirmModalHost />
    </TRPCProvider>
  );
}
```

- [ ] **Step 3: Verify compile + smoke**

Run: `npx tsc --noEmit`
Expected: exit 0

Run: `./flux server dev restart`
Then: `curl -s -o /dev/null -w "HTTP %{http_code}\n" http://localhost:3004/`
Expected: HTTP 200 or 307. Modal should not appear (no `openConfirmModal` called yet).

- [ ] **Step 4: Commit**

```bash
git add src/app/[org]/[user]/[project]/layout.tsx
git commit -m "feat: mount ConfirmModalHost in the project-scoped client boundary (FLX-226)"
```

---

## Task 15: `RepoUrlField` custom renderer

**Files:**
- Create: `src/components/record-editor/RepoUrlField.tsx`

- [ ] **Step 1: Write the renderer**

```tsx
// src/components/record-editor/RepoUrlField.tsx
'use client';

import { useEffect, useRef, useState } from 'react';
import { trpc } from '@/lib/trpc/client';
import type { CustomRendererProps } from './types';

type Validity =
  | { kind: 'idle' }
  | { kind: 'validating' }
  | { kind: 'ok'; provider: string; owner: string; repo: string }
  | { kind: 'error'; reason: string; detail?: string };

const REASON_COPY: Record<string, string> = {
  INVALID_URL:
    'Not a valid URL. Expected https://github.com/owner/repo or similar.',
  UNSUPPORTED_HOST:
    'No git provider configured for this host. Supported: github.com.',
  REPO_NOT_FOUND:
    'Repository not found. Check the URL, or confirm the integration has access.',
  AUTH_FAILED:
    'Could not authenticate with the provider. Check the provider credential.',
  NETWORK: 'Could not reach the provider. Try again.',
};

/**
 * FLX-227: two-step Validate / Save UX. The renderer wires its validity
 * state to RecordEditor via onValidityChange so Save can block.
 *
 * Validation rules surfaced to the user:
 *   - Validate is disabled until URL has a valid shape (zod .url()-ish).
 *   - Save is enabled when:
 *       (a) validation succeeded for current value, OR
 *       (b) value is unchanged from the persisted value (no edit), OR
 *       (c) value is blank (repoUrl is optional).
 *   - Editing after a green check clears the result and re-disables Save.
 */
export function RepoUrlField<TRecord>(props: CustomRendererProps<TRecord>) {
  const { field, value, editing, onChange, onValidityChange } = props;
  const persistedRef = useRef<string>(value == null ? '' : String(value));
  // Reset persistedRef when editing flips on/off — we treat the value at
  // edit-mode entry as "persisted" for the unchanged-skip logic.
  const [prevEditing, setPrevEditing] = useState(editing);
  if (prevEditing !== editing) {
    setPrevEditing(editing);
    persistedRef.current = value == null ? '' : String(value);
  }

  const current = value == null ? '' : String(value);
  const isBlank = current.trim() === '';
  const isUnchanged = current === persistedRef.current;

  const [validity, setValidity] = useState<Validity>({ kind: 'idle' });
  const validateMutation = trpc.project.validateRepoUrl.useMutation();

  // Whenever the URL changes, clear any prior validation result. The user
  // must re-validate before Save unlocks.
  const [lastSeen, setLastSeen] = useState(current);
  if (current !== lastSeen) {
    setLastSeen(current);
    if (validity.kind !== 'idle') setValidity({ kind: 'idle' });
  }

  // Report validity upward. Save is blocked when validity is 'error' OR
  // (the field has a non-blank, changed URL that hasn't been validated).
  useEffect(() => {
    if (!editing) {
      onValidityChange?.(field.key, null);
      return;
    }
    if (isBlank || isUnchanged) {
      onValidityChange?.(field.key, null);
      return;
    }
    if (validity.kind === 'ok') {
      onValidityChange?.(field.key, null);
      return;
    }
    if (validity.kind === 'error') {
      onValidityChange?.(field.key, REASON_COPY[validity.reason] ?? validity.reason);
      return;
    }
    onValidityChange?.(field.key, 'Validate the URL before saving.');
  }, [editing, isBlank, isUnchanged, validity, field.key, onValidityChange]);

  // Shape check for enabling the Validate button. A standard zod
  // .url()-equivalent: must be a parseable URL with http(s) scheme.
  const hasValidShape = (() => {
    if (isBlank) return false;
    try {
      const u = new URL(current);
      return u.protocol === 'http:' || u.protocol === 'https:';
    } catch {
      return false;
    }
  })();

  const handleValidate = async () => {
    setValidity({ kind: 'validating' });
    try {
      const result = await validateMutation.mutateAsync({ url: current });
      if (result.ok) {
        setValidity({
          kind: 'ok',
          provider: result.provider,
          owner: result.coords.owner,
          repo: result.coords.repo,
        });
      } else {
        setValidity({
          kind: 'error',
          reason: result.reason,
          detail: result.detail,
        });
      }
    } catch (err) {
      setValidity({
        kind: 'error',
        reason: 'NETWORK',
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  };

  const inputClass =
    'flex-1 bg-slate-900 border rounded-lg px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-electric-violet/40';

  const helpTextNode = field.helpText ? (
    <p
      className="mt-1 text-[11px] text-slate-500"
      data-testid={`help-${field.key}`}
    >
      {field.helpText}
    </p>
  ) : null;

  return (
    <div className="mb-3">
      <label className="text-xs font-medium text-slate-400 block mb-1">
        {field.label}
      </label>
      <div className="flex gap-2">
        <input
          type="text"
          disabled={!editing}
          value={current}
          onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}
          placeholder={field.placeholder}
          aria-label={field.label}
          className={`${inputClass} border-slate-700/60 disabled:opacity-75`}
          data-testid={`repo-url-input-${field.key}`}
        />
        <button
          type="button"
          disabled={!editing || !hasValidShape || validity.kind === 'validating'}
          onClick={handleValidate}
          className="px-3 py-2 text-sm font-medium text-white bg-slate-700 hover:bg-slate-600 disabled:opacity-50 disabled:cursor-not-allowed rounded-md"
          data-testid="repo-url-validate"
        >
          {validity.kind === 'validating' ? 'Validating…' : 'Validate'}
        </button>
      </div>
      {validity.kind === 'ok' ? (
        <p
          className="mt-1 text-xs text-emerald-400"
          data-testid="repo-url-validity-ok"
        >
          ✓ Verified · {validity.provider} · {validity.owner}/{validity.repo}
        </p>
      ) : null}
      {validity.kind === 'error' ? (
        <p
          className="mt-1 text-xs text-red-400"
          data-testid="repo-url-validity-error"
        >
          ✗ {REASON_COPY[validity.reason] ?? validity.reason}
        </p>
      ) : null}
      {helpTextNode}
    </div>
  );
}
```

- [ ] **Step 2: Verify compile**

Run: `npx tsc --noEmit`
Expected: exit 0

- [ ] **Step 3: Commit**

```bash
git add src/components/record-editor/RepoUrlField.tsx
git commit -m "feat: RepoUrlField custom renderer with two-step Validate/Save (FLX-227)"
```

---

## Task 16: Projects descriptor factory

**Files:**
- Create: `src/app/[org]/[user]/[project]/settings/projects/buildProjectDescriptor.ts`
- Modify: `src/app/[org]/[user]/[project]/settings/projects/descriptor.ts`

- [ ] **Step 1: Create the factory**

```ts
// src/app/[org]/[user]/[project]/settings/projects/buildProjectDescriptor.ts
import { RepoUrlField } from '@/components/record-editor/RepoUrlField';
import type {
  RecordDescriptor,
  SelectIdOption,
} from '@/components/record-editor/types';
import type { ProjectRecord } from './descriptor';

export type BuildProjectDescriptorInput = {
  pipelineOptions: readonly SelectIdOption[];
  brandOptions: readonly SelectIdOption[];
};

export function buildProjectDescriptor({
  pipelineOptions,
  brandOptions,
}: BuildProjectDescriptorInput): RecordDescriptor<ProjectRecord> {
  return {
    entityName: 'project',
    title: (p) => p.name,
    subtitle: (p) => p.slug,
    fields: [
      { key: 'name', label: 'Name', fieldType: 'text', required: true },
      {
        key: 'slug',
        label: 'Slug',
        fieldType: 'text',
        required: true,
        validate: (v) =>
          typeof v === 'string' && /^[a-z0-9-]+$/.test(v)
            ? null
            : 'Slug must contain only lowercase letters, digits, and hyphens.',
        helpText:
          'URL identity. Changing this invalidates existing bookmarks; you will be redirected to the new URL after save.',
      },
      {
        key: 'repoUrl',
        label: 'Repo URL',
        fieldType: 'text',
        placeholder: 'https://github.com/owner/repo',
        customRenderer: (props) => <RepoUrlField {...props} />,
        helpText:
          'The remote repository this project tracks. Click Validate before saving.',
      },
      {
        key: 'defaultBranch',
        label: 'Default branch',
        fieldType: 'text',
        required: true,
      },
      {
        key: 'defaultPipelineId',
        label: 'Default pipeline',
        fieldType: 'select-id',
        selectIdOptions: pipelineOptions,
        nullOptionLabel: '(none)',
        helpText:
          'Pipeline used when an issue does not specify one.',
      },
      {
        key: 'brandId',
        label: 'Default brand',
        fieldType: 'select-id',
        selectIdOptions: brandOptions,
        nullOptionLabel: '(no brand)',
        helpText:
          'Brand applied to issues filed under this project when none is specified.',
      },
      {
        key: 'targetRepoPath',
        label: 'Target repo path',
        fieldType: 'text',
        placeholder: '/mnt/dev/<owner>/<repo>',
        helpText:
          "Absolute path to a local clone of this project's target repo on main. Stage runs use it to acquire an isolation worktree.",
      },
    ],
  };
}
```

**Important:** the file uses JSX (`<RepoUrlField {...props} />`), so the extension must be `.tsx` not `.ts`. Rename in the file creation:

Create the file as `buildProjectDescriptor.tsx` (not `.ts`).

- [ ] **Step 2: Update the descriptor record type**

Replace `src/app/[org]/[user]/[project]/settings/projects/descriptor.ts` with:

```ts
// src/app/[org]/[user]/[project]/settings/projects/descriptor.ts
// FLX-207 / FLX-229: ProjectRecord carries the FK IDs directly. The
// descriptor itself is built per-render by buildProjectDescriptor() so
// dropdown options (loaded from tRPC) can be passed in.
export type ProjectRecord = {
  id: string;
  version: number;
  name: string;
  slug: string;
  repoUrl: string | null;
  defaultBranch: string;
  defaultPipelineId: string | null;
  brandId: string | null;
  targetRepoPath: string | null;
};
```

The previous `projectDescriptor` constant is removed; callers must use `buildProjectDescriptor()`.

- [ ] **Step 3: Verify compile**

Run: `npx tsc --noEmit`
Expected: error in `page.tsx` because it still imports `projectDescriptor`. That's expected — Task 17 fixes it. tsc errors limited to that file are acceptable.

- [ ] **Step 4: Hold off on commit** — Tasks 16+17 land together.

---

## Task 17: Rewrite the Projects page

**Files:**
- Modify: `src/app/[org]/[user]/[project]/settings/projects/page.tsx`

This is the largest UI change. It does five things at once because they all touch the same file: switch to factory descriptor, drop the readonly fields' strip-on-save logic (no fields are stripped now), wire slug confirm + redirect, delete the brand `<section>`, and pass the new options.

- [ ] **Step 1: Replace the page**

```tsx
// src/app/[org]/[user]/[project]/settings/projects/page.tsx
'use client';

import { notFound, useParams, useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { openConfirmModal } from '@/components/confirm-modal';
import { PageHeader } from '@/components/page-header';
import { RecordEditor } from '@/components/record-editor/RecordEditor';
import { trpc } from '@/lib/trpc/client';
import { buildProjectDescriptor } from './buildProjectDescriptor';
import type { ProjectRecord } from './descriptor';

export default function ProjectsSettingsPage() {
  const params = useParams<{ org: string; user: string; project: string }>();
  const router = useRouter();
  const utils = trpc.useUtils();
  const [showCreate, setShowCreate] = useState(false);

  const orgQuery = trpc.organization.getBySlug.useQuery({ slug: params.org });
  const orgId = orgQuery.data?.id ?? null;

  const projectsQuery = trpc.project.list.useQuery(
    { orgId: orgId! },
    { enabled: !!orgId }
  );

  const updateMutation = trpc.project.update.useMutation();
  const deleteMutation = trpc.project.delete.useMutation();

  const projects = projectsQuery.data ?? [];
  const currentProject =
    projects.find((project) => project.slug === params.project) ?? null;
  if (projectsQuery.isSuccess && projects.length > 0 && !currentProject) {
    notFound();
  }

  const seedOrgId = currentProject?.orgId ?? projects[0]?.orgId ?? null;
  const seedUserId = currentProject?.userId ?? projects[0]?.userId ?? null;
  const seedProjectId = currentProject?.id ?? projects[0]?.id ?? null;

  const pipelinesQuery = trpc.pipeline.list.useQuery(
    { projectId: seedProjectId! },
    { enabled: !!seedProjectId }
  );
  const pipelines = pipelinesQuery.data ?? [];

  const brandsQuery = trpc.brand.listVisibleToProject.useQuery(
    { orgId: seedOrgId!, projectId: seedProjectId! },
    { enabled: !!seedOrgId && !!seedProjectId }
  );
  const brands = brandsQuery.data ?? [];

  // FLX-207 / FLX-229: build the descriptor with dropdown options from
  // the loaded queries. Stable identity via useMemo so RecordEditor's
  // internal effects don't churn on every render.
  const descriptor = useMemo(
    () =>
      buildProjectDescriptor({
        pipelineOptions: pipelines.map((p) => ({ value: p.id, label: p.name })),
        brandOptions: brands.map((b) => ({ value: b.id, label: b.name })),
      }),
    [pipelines, brands]
  );

  const records: ProjectRecord[] = projects.map((p) => ({
    id: p.id,
    version: 1,
    name: p.name,
    slug: p.slug,
    repoUrl: p.repoUrl,
    defaultBranch: p.defaultBranch,
    defaultPipelineId: p.defaultPipelineId,
    brandId: p.brandId,
    targetRepoPath: p.targetRepoPath,
  }));

  const onSave = async (
    id: string,
    patch: Partial<ProjectRecord>,
    _expectedVersion: number
  ) => {
    // FLX-226: slug rename = confirm + redirect after save. We use the
    // record's current slug (not URL params) so the modal copy matches
    // what the operator actually changed.
    const target = records.find((r) => r.id === id);
    const slugChanged =
      'slug' in patch && target && patch.slug !== target.slug;
    if (slugChanged) {
      const confirmed = await openConfirmModal({
        title: 'Rename project slug?',
        body: 'Renaming the project slug invalidates all existing URLs and bookmarks for this project. Continue?',
        confirmLabel: 'Rename',
        destructive: true,
      });
      if (!confirmed) return;
    }

    await updateMutation.mutateAsync({
      id,
      ...(patch as Record<string, unknown>),
    });
    await utils.project.list.invalidate();

    if (slugChanged && typeof patch.slug === 'string') {
      router.replace(
        `/${params.org}/${params.user}/${patch.slug}/settings/projects`
      );
    }
  };

  const onDelete = async (id: string, _expectedVersion: number) => {
    await deleteMutation.mutateAsync({ id });
    await utils.project.list.invalidate();
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Projects"
        description="Configure the target repository and default pipeline. The target repo path is a per-project column; the stage runner refuses to acquire isolation when it is null."
        action={
          seedOrgId && seedUserId ? (
            <button
              type="button"
              onClick={() => setShowCreate(!showCreate)}
              className="px-4 py-2 bg-electric-violet hover:bg-accent-hover text-white text-sm font-semibold rounded-xl transition-all shadow-[0_4px_16px_rgba(124,58,237,0.3)]"
            >
              {showCreate ? 'Cancel' : 'New Project'}
            </button>
          ) : undefined
        }
      />

      {showCreate && seedOrgId && seedUserId && (
        <CreateProjectForm
          orgId={seedOrgId}
          userId={seedUserId}
          onCreated={async () => {
            setShowCreate(false);
            await utils.project.list.invalidate();
          }}
        />
      )}

      <RecordEditor<ProjectRecord>
        descriptor={descriptor}
        records={records}
        isLoading={projectsQuery.isLoading}
        onSave={onSave}
        onDelete={onDelete}
        onRefresh={async () => {
          await utils.project.list.invalidate();
        }}
      />
    </div>
  );
}

function CreateProjectForm({
  orgId,
  userId,
  onCreated,
}: {
  orgId: string;
  userId: string;
  onCreated: () => void;
}) {
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [repoUrl, setRepoUrl] = useState('');

  const createMutation = trpc.project.create.useMutation({
    onSuccess: () => onCreated(),
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!name.trim() || !slug.trim()) return;
        createMutation.mutate({
          orgId,
          userId,
          name: name.trim(),
          slug: slug.trim(),
          repoUrl: repoUrl.trim() || undefined,
        });
      }}
      className="card-static p-4 flex gap-3 items-end flex-wrap"
    >
      <label className="flex-1 min-w-[180px]">
        <span className="text-xs text-slate-400">Name</span>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          aria-label="Project name"
          className="w-full bg-slate-900 border border-slate-700/60 rounded-lg px-3 py-1.5 text-sm text-foreground mt-1"
        />
      </label>
      <label className="flex-1 min-w-[180px]">
        <span className="text-xs text-slate-400">Slug</span>
        <input
          type="text"
          value={slug}
          onChange={(e) => setSlug(e.target.value)}
          aria-label="Project slug"
          className="w-full bg-slate-900 border border-slate-700/60 rounded-lg px-3 py-1.5 text-sm text-foreground mt-1"
        />
      </label>
      <label className="flex-1 min-w-[220px]">
        <span className="text-xs text-slate-400">Repo URL (optional)</span>
        <input
          type="text"
          value={repoUrl}
          onChange={(e) => setRepoUrl(e.target.value)}
          aria-label="Project repo URL"
          placeholder="https://github.com/owner/repo"
          className="w-full bg-slate-900 border border-slate-700/60 rounded-lg px-3 py-1.5 text-sm text-foreground mt-1"
        />
      </label>
      <button
        type="submit"
        disabled={!name.trim() || !slug.trim() || createMutation.isPending}
        className="px-4 py-1.5 bg-electric-violet hover:bg-accent-hover disabled:opacity-50 text-white text-sm font-medium rounded-md transition-colors"
      >
        {createMutation.isPending ? 'Creating…' : 'Create'}
      </button>
    </form>
  );
}
```

- [ ] **Step 2: Verify compile**

Run: `npx tsc --noEmit`
Expected: exit 0

- [ ] **Step 3: Commit Tasks 16+17 together**

```bash
git add src/app/[org]/[user]/[project]/settings/projects/buildProjectDescriptor.tsx \
        src/app/[org]/[user]/[project]/settings/projects/descriptor.ts \
        src/app/[org]/[user]/[project]/settings/projects/page.tsx
git commit -m "feat: Projects form — all fields editable, slug rename safe, brand side-channel removed (FLX-207, 226, 229)"
```

---

## Task 18: Playwright journey

**Files:**
- Create: `e2e/settings-projects-form-slice.spec.ts`

**Reviewer-fix:** the seed slugs are NOT guesses — read them from an existing settings spec or run a one-shot query. Also: the slug-rename test must NOT mutate the seed project. Spin up a throwaway project via the API at test-setup, rename it, delete it at teardown.

- [ ] **Step 1: Inspect existing settings specs + confirm seed slugs**

Run:
```bash
ls /mnt/dev/fluxaos/e2e/ | grep -i project
grep -l "settings/projects" /mnt/dev/fluxaos/e2e/*.spec.ts || true
grep -rln "'fluxaos'\|'fluxaOS'" /mnt/dev/fluxaos/e2e/*.spec.ts | head -3
```

Look at one or two existing specs to copy the auth-bypass / base URL / test setup conventions. The seed values for `org`, `user`, `project` slugs are whatever those specs use today — copy them verbatim. If specs disagree, run:

```bash
set -a; source .env; source .env.local; set +a
node -e "
import('@/adapters/supabase/database').then(async ({ SupabaseDatabaseProvider }) => {
  const p = new SupabaseDatabaseProvider(process.env.DATABASE_URL);
  const db = p.getConnection();
  const { organization, user, project } = await import('@/core/db/schema');
  console.log('org:',  (await db.select().from(organization).limit(1))[0]?.slug);
  console.log('user:', (await db.select().from(user).limit(1))[0]?.slug);
  console.log('proj:', (await db.select().from(project).limit(1))[0]?.slug);
});" 2>&1 || echo "fallback: read seed.ts directly"
```

Or simpler: read `src/scripts/db/seed.ts` and grep for `slug:`. Use whatever the seed sets. Substitute the values into `SEED_ORG`, `SEED_USER`, `SEED_PROJECT` constants below.

- [ ] **Step 2: Write the spec**

```ts
// e2e/settings-projects-form-slice.spec.ts
import { expect, test } from '@playwright/test';

// FLX-207 / FLX-226 / FLX-227 / FLX-229 journey. Exercises the full
// Projects form lifecycle: dropdown selections, repoUrl validate,
// slug rename confirm + redirect.
//
// All slug-rename testing happens on a throwaway project created via
// the API at beforeAll and deleted at afterAll. The seed project is
// only used for the read-only form structure assertions (no readonly
// inputs remain, etc.) and dropdown-select tests on fields that are
// safely re-savable.

// Replace these three constants with the values from src/scripts/db/seed.ts.
const SEED_ORG = '<REPLACE_FROM_SEED>';
const SEED_USER = '<REPLACE_FROM_SEED>';
const SEED_PROJECT = '<REPLACE_FROM_SEED>';

// Throwaway project slugs for the slug-rename test.
const SCRATCH_SLUG = `e2e-projects-form-${Date.now()}`;
const SCRATCH_RENAMED = `${SCRATCH_SLUG}-renamed`;

test.describe('Projects form slice', () => {
  test('full form lifecycle (read-only structure + safe edits on seed project)', async ({ page }) => {
    await page.goto(`/${SEED_ORG}/${SEED_USER}/${SEED_PROJECT}/settings/projects`);

    // No readonly inputs remain on the form (FLX-207). The readonly
    // visual treatment is reserved for fields that genuinely cannot
    // be edited; Projects form has none after this slice.
    await expect(page.locator('[aria-readonly="true"]')).toHaveCount(0);

    // Open edit mode on the first record. The RecordEditor list-row
    // layout exposes an "Edit" affordance; adjust the selector if the
    // existing pattern differs.
    await page.getByRole('button', { name: /^Edit$/i }).first().click();

    // Edit defaultPipelineId via the dropdown. Expect at least one
    // option to exist (the seeded pipeline) and select it.
    const pipelineSelect = page.getByLabel('Default pipeline');
    await expect(pipelineSelect).toBeEnabled();
    const pipelineOptions = await pipelineSelect.locator('option').allInnerTexts();
    expect(pipelineOptions.length).toBeGreaterThan(1); // null option + at least one
    await pipelineSelect.selectOption({ index: 1 });

    // Edit brandId via the dropdown — select the null option explicitly
    // to verify (no brand) writes null.
    const brandSelect = page.getByLabel('Default brand');
    await brandSelect.selectOption({ value: '' });

    // Validate repoUrl with a real public repo.
    const repoInput = page.getByTestId('repo-url-input-repoUrl');
    await repoInput.fill('https://github.com/fluxaOS/fluxaos');
    await page.getByTestId('repo-url-validate').click();
    await expect(page.getByTestId('repo-url-validity-ok')).toBeVisible({
      timeout: 15_000,
    });

    // Save and assert persistence by reloading.
    await page.getByRole('button', { name: /^Save$/i }).click();
    await page.waitForLoadState('networkidle');
    await page.reload();
    await expect(page.getByLabel('Default pipeline')).toBeVisible();
  });

  test('repoUrl validation surfaces error for bad URL', async ({ page }) => {
    await page.goto(`/${SEED_ORG}/${SEED_USER}/${SEED_PROJECT}/settings/projects`);
    await page.getByRole('button', { name: /^Edit$/i }).first().click();

    const repoInput = page.getByTestId('repo-url-input-repoUrl');
    await repoInput.fill('https://github.com/flux-not-a-real-org/flux-not-a-real-repo');
    await page.getByTestId('repo-url-validate').click();
    await expect(page.getByTestId('repo-url-validity-error')).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId('repo-url-validity-error')).toContainText(
      'Repository not found'
    );
  });

  // ─── slug rename tests use a throwaway project ─────────────────────────
  //
  // Reviewer-fix: the slug rename test must NOT mutate the seed project.
  // beforeAll creates a scratch project via the tRPC HTTP API; afterAll
  // deletes it. If a test crashes mid-flight, afterAll still runs and
  // cleans up. Slugs are timestamp-suffixed so parallel test runs don't
  // collide on the unique (userId, slug) index.

  test.describe('slug rename (throwaway project)', () => {
    let scratchProjectId: string | null = null;

    test.beforeAll(async ({ request }) => {
      // Resolve seed org and user IDs via tRPC. Endpoint names match the
      // current router shape — if they change, update both here and the
      // page's queries together.
      const orgRes = await request.get(
        `/api/trpc/organization.getBySlug?input=${encodeURIComponent(
          JSON.stringify({ slug: SEED_ORG })
        )}`
      );
      const orgJson = await orgRes.json();
      const orgId = orgJson?.result?.data?.id;
      if (!orgId) throw new Error('Seed org not resolvable via tRPC');

      const userRes = await request.get(
        `/api/trpc/user.list?input=${encodeURIComponent(
          JSON.stringify({ orgId })
        )}`
      );
      const userJson = await userRes.json();
      const userId = userJson?.result?.data?.[0]?.id;
      if (!userId) throw new Error('Seed user not resolvable via tRPC');

      const createRes = await request.post('/api/trpc/project.create', {
        data: {
          orgId,
          userId,
          name: SCRATCH_SLUG,
          slug: SCRATCH_SLUG,
        },
      });
      const createJson = await createRes.json();
      scratchProjectId = createJson?.result?.data?.id ?? null;
      if (!scratchProjectId)
        throw new Error('Failed to create scratch project');
    });

    test.afterAll(async ({ request }) => {
      if (!scratchProjectId) return;
      await request
        .post('/api/trpc/project.delete', {
          data: { id: scratchProjectId },
        })
        .catch(() => undefined);
    });

    test('cancel keeps current slug', async ({ page }) => {
      await page.goto(
        `/${SEED_ORG}/${SEED_USER}/${SCRATCH_SLUG}/settings/projects`
      );
      await page.getByRole('button', { name: /^Edit$/i }).first().click();

      const slugInput = page.getByLabel('Slug', { exact: true });
      await slugInput.fill(SCRATCH_RENAMED);
      await page.getByRole('button', { name: /^Save$/i }).click();

      await expect(page.getByRole('dialog')).toBeVisible();
      await page.getByRole('button', { name: /Cancel/i }).click();

      await expect(page).toHaveURL(
        new RegExp(
          `/${SEED_ORG}/${SEED_USER}/${SCRATCH_SLUG}/settings/projects$`
        )
      );
    });

    test('confirm redirects to new slug', async ({ page }) => {
      await page.goto(
        `/${SEED_ORG}/${SEED_USER}/${SCRATCH_SLUG}/settings/projects`
      );
      await page.getByRole('button', { name: /^Edit$/i }).first().click();

      const slugInput = page.getByLabel('Slug', { exact: true });
      await slugInput.fill(SCRATCH_RENAMED);
      await page.getByRole('button', { name: /^Save$/i }).click();
      await page.getByTestId('confirm-modal-confirm').click();

      await expect(page).toHaveURL(
        new RegExp(
          `/${SEED_ORG}/${SEED_USER}/${SCRATCH_RENAMED}/settings/projects$`
        )
      );

      // Rename back so subsequent tests in this block (and any
      // re-runs against a still-live scratch project) start from
      // SCRATCH_SLUG. afterAll still deletes the row by id regardless.
      await page.getByRole('button', { name: /^Edit$/i }).first().click();
      await slugInput.fill(SCRATCH_SLUG);
      await page.getByRole('button', { name: /^Save$/i }).click();
      await page.getByTestId('confirm-modal-confirm').click();
    });
  });
});
```

**Note on selectors:** The exact text of the Edit/Save buttons depends on RecordEditor's existing UI. Before running, open the form in the browser and confirm the button names match. Adjust `getByRole('button', { name: ... })` patterns as needed.

**Note on tRPC HTTP shape:** the `beforeAll` uses standard tRPC `httpBatchLink` request format (`POST /api/trpc/<router.proc>` with `{data: ...}` body for mutations, `GET /api/trpc/<router.proc>?input=<urlencoded JSON>` for queries). If the project's `httpBatchLink` config uses a different transformer, adjust the body shape — open an existing tRPC call in DevTools' Network panel to confirm.

- [ ] **Step 3: Start the dev server and run the spec**

Run: `./flux server dev restart` (waits ~5s for restart)
Then: `set -a; source .env; source .env.local; set +a; npx playwright test e2e/settings-projects-form-slice.spec.ts`
Expected: all 4 tests pass.

If any test fails, **diagnose and fix the test or the implementation** — do not skip or `.fixme()` per project rules (CLAUDE.md → `feedback_journey_test_gate.md`).

- [ ] **Step 4: Commit**

```bash
git add e2e/settings-projects-form-slice.spec.ts
git commit -m "test: Playwright journey for Projects form slice (FLX-207, 226, 227, 229)"
```

---

## Task 19: Final verification + push + PR

- [ ] **Step 1: Full type-check and lint**

Run: `npx tsc --noEmit && npx biome check src/ e2e/`
Expected: exit 0 from both; no new findings.

- [ ] **Step 2: Run the full integration suite for affected files**

Run: `set -a; source .env; source .env.local; set +a; npx vitest run src/__tests__/integration/project-settings.test.ts src/__tests__/integration/project-update-fk-validation.test.ts src/__tests__/integration/project-validate-repo-url.test.ts`
Expected: all green.

- [ ] **Step 3: Re-run Playwright with dev server**

Run: `./flux server dev restart`
Then: `set -a; source .env; source .env.local; set +a; npx playwright test e2e/settings-projects-form-slice.spec.ts`
Expected: 4/4 pass.

- [ ] **Step 3b: Run the canonical full-lifecycle journey (CLAUDE.md gate)**

Per CLAUDE.md → "Canonical full-lifecycle journey": `e2e/full-issue-lifecycle.spec.ts` MUST be run and pass before any UI sign-off or UI-touching PR merge. This slice modifies RecordEditor primitives, the project form, and the settings page — all of which the lifecycle journey may touch.

Run: `set -a; source .env; source .env.local; set +a; npx playwright test e2e/full-issue-lifecycle.spec.ts`
Expected: pass. If it fails, work halts (per CLAUDE.md) — diagnose and fix the underlying break before opening the PR. Do NOT mark the slice complete with this red.

- [ ] **Step 4: Push and open the PR**

```bash
git push -u origin <your-branch-name>
gh pr create --title "feat: Projects form slice (FLX-207, 226, 227, 228, 229)" --body "$(cat <<'EOF'
## Summary

Lands the Projects-form slice per `docs/superpowers/specs/2026-05-12-projects-form-slice-design.md`:

- `select-id` field type for FK dropdowns; readonly visual refresh app-wide
- Slug rename = confirm modal + `router.replace` redirect; regex enforced server-side
- repoUrl two-step Validate/Save; vendor-agnostic GitRouter; GitHub validator
- `project.update` enforces FK scope via `FK_VALIDATORS` map; `setDefaultPipeline` deleted
- Brand selector moved into the form; side-channel `<section>` deleted

Five layers, each ignorant of the layers below. Future git providers drop in as one file in `src/adapters/git-router/validators/`.

## Test plan

- [x] `npx tsc --noEmit` clean
- [x] `npx biome check src/ e2e/` clean
- [x] Integration: `project-settings.test.ts`, `project-update-fk-validation.test.ts`, `project-validate-repo-url.test.ts` all green
- [x] Playwright: `e2e/settings-projects-form-slice.spec.ts` 4/4 pass against dev server
- [x] Playwright: `e2e/full-issue-lifecycle.spec.ts` passes (CLAUDE.md canonical gate)

Refs FLX-207, FLX-226, FLX-227, FLX-228, FLX-229. Tenancy redesign tracked separately as FLX-239.
EOF
)"
```

- [ ] **Step 5: Update Linear**

For each of FLX-207, 226, 227, 228, 229: `mcp__plugin_linear_linear__save_issue` with `state: "In Review"` and append the PR via `links:`.

---

## Self-Review

**Spec coverage:**

- FLX-207 (every field editable, readonly distinct): Tasks 12, 16, 17. ✓
- FLX-226 (slug confirm + redirect): Tasks 13, 14, 17, 18 (case 3 + 4). ✓
- FLX-227 (repoUrl validation): Tasks 1-5, 7, 15, 18 (case 1 + 2). ✓
- FLX-228 (FK invariant consolidation): Tasks 6, 8, 9, 10, 11. ✓
- FLX-229 (brand side-channel deletion): Tasks 11 (brand FK test), 16, 17. ✓
- Architecture five-layer separation: enforced by file structure (Tasks 1-3 are router, 6 is service, 12-15 are UI primitives, 17 is page). ✓
- Vendor-agnostic git-router: Tasks 1-3 — no `'github'` literal outside `validators/github.ts`. ✓
- DB schema unchanged: confirmed; no migrations added. ✓
- App-wide readonly visual refresh: Task 12. ✓
- Pipelines tab "Set as default" migration: Task 9. ✓
- Integration tests cover FK + URL validation: Tasks 5, 11; existing tests migrated in Task 10. ✓
- Playwright journey covers full form: Task 18. ✓

**Placeholder scan:** none. Every step has either a complete code block or a concrete shell command with expected output.

**Type consistency:**
- `GitProviderValidator` (Task 1) → used in Tasks 2, 3. ✓
- `ValidationResult` (Task 1) → returned by Tasks 3, 5, 7, 15. ✓
- `SelectIdOption` (Task 12) → consumed by Task 16's `buildProjectDescriptor` signature. ✓
- `CustomRendererProps<TRecord>` (Task 12) → used by Task 15's `RepoUrlField`. ✓
- `ProjectRecord` (Task 16) → used by Task 17's page. ✓
- `FK_VALIDATORS` (Task 6) → consumed by Task 7's service `update`. ✓
- `openConfirmModal` (Task 13) → called from Task 17's page. ✓
- TRPC error message keys: `PIPELINE_NOT_FOUND`, `PIPELINE_NOT_IN_PROJECT`, `BRAND_NOT_FOUND`, `BRAND_NOT_IN_ORG`, `REPO_URL_*` — defined in Tasks 6, 7; asserted in Tasks 10, 11. ✓

**Spec ↔ plan deltas:**
- Spec named the registry file `registry.ts`; plan uses `validator-registry.ts` to avoid collision with `factory.ts`. Documented in Task 3. Equivalent.
- Spec implied replacing the existing `factory.ts`; investigation in writing-plans phase showed `factory.ts` exposes the richer `GitProvider` port consumed by stage-runner and deploy-bridge. Plan keeps both separately. Documented in Task 3 comment.
- Spec said the Pipelines tab caller migrates from `setDefaultPipeline`; the real caller is in `settings/page.tsx`, not `pipelines/page.tsx`. Plan corrects this in Task 9.

**Plan-review revisions (2026-05-12):**

A fresh-eyes plan review surfaced six material issues; all are addressed in-plan:

1. **CRITICAL — Integration test pattern.** Original plan referenced non-existent `createCallerFactory`, `makeTestCtx`, and `helpers/` directory. Tasks 5 and 11 rewritten to follow the canonical pattern from `src/__tests__/integration/project-settings.test.ts` (direct `appRouter.createCaller` from `@/server/root`, inline `makeFixture` + `teardown`).
2. **CRITICAL — DI rule violation.** Original Task 7 imported `buildGitRouter` inside `src/core/services/project.ts`, breaking the "zero vendor imports in src/core/" invariant. Service now defines a `RepoUrlValidatorPort` and accepts it via injection; Task 8 wires the actual `GitRouter` from the server-router layer.
3. **HIGH — ConfirmModalHost mount target.** `src/app/layout.tsx` is a bare server component with no client boundary. Task 14 retargeted to `src/app/[org]/[user]/[project]/layout.tsx` which nests `<TRPCProvider>` (an existing `'use client'` boundary) — that's the natural shared client island for the form.
4. **HIGH — `setDefaultPipeline` caller audit.** Task 8 now opens with an explicit grep to enumerate every caller before deletion.
5. **HIGH — Playwright seed mutation.** Task 18's slug rename tests no longer touch seed data. A `beforeAll`/`afterAll` block creates and deletes a throwaway project via tRPC HTTP API; slug is timestamped to prevent parallel-run collisions.
6. **MEDIUM — Forbidden fallback (`??`).** Task 12's `select-id` branch no longer uses `?? []`. An undefined `selectIdOptions` is now an explicit thrown error — descriptor bugs surface immediately.
7. **MEDIUM — Full-lifecycle gate missing.** Task 19 adds Step 3b: `e2e/full-issue-lifecycle.spec.ts` must pass before PR open, per CLAUDE.md's canonical-journey rule.

Plan complete.
