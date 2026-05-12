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

- [ ] **Step 1: Write the failing test**

```ts
// src/__tests__/integration/project-validate-repo-url.test.ts
import { describe, expect, it } from 'vitest';
import { buildGitRouter } from '@/adapters/git-router/validator-registry';

describe('GitRouter.validate (FLX-227)', () => {
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

- [ ] **Step 1: Replace the service to add `update()`**

The file currently re-exports `crud.update` implicitly via `...crud`. Replace the whole file:

```ts
// src/core/services/project.ts
import { TRPCError } from '@trpc/server';
import { and, eq } from 'drizzle-orm';
import { buildGitRouter } from '@/adapters/git-router/validator-registry';
import type { Database } from '@/core/db/connection';
import { project } from '@/core/db/schema';
import { createCrudService } from './crud-factory';
import { FK_VALIDATORS } from './project-fk-validators';

type ProjectInsert = typeof project.$inferInsert;
type ProjectSelect = typeof project.$inferSelect;

export function createProjectService(db: Database) {
  const crud = createCrudService<ProjectInsert, ProjectSelect>(db, project);

  return {
    ...crud,

    /**
     * FLX-228 / FLX-229: walk FK_VALIDATORS for every key in the patch
     * so FK scope is enforced in one place. FLX-227: when `repoUrl` is
     * in the patch and non-null, re-validate via gitRouter. The server
     * is authoritative; the form's "Validate" button is a UX hint, not
     * a save gate.
     */
    async update(id: string, patch: Partial<ProjectInsert>) {
      for (const key of Object.keys(patch)) {
        const validator = FK_VALIDATORS[key];
        if (validator) {
          await validator(db, id, (patch as Record<string, unknown>)[key]);
        }
      }

      if ('repoUrl' in patch && patch.repoUrl != null) {
        const router = buildGitRouter();
        const result = await router.validate(patch.repoUrl as string);
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

- [ ] **Step 1: Tighten `update` input**

Find the `update` block (around lines 54-73). Replace the input definition:

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
      return createProjectService(ctx.db).update(id, data);
    }),
```

- [ ] **Step 2: Delete `setDefaultPipeline`**

Remove the entire `setDefaultPipeline` block (lines ~88-116 in the original file). Also remove the unused `TRPCError` import IF nothing else in the file uses it (check first — `getById` etc. don't throw, but `inputId()` might). Run `grep TRPCError src/server/routers/project.ts` after removing the block; if no matches remain, drop the import.

- [ ] **Step 3: Verify compile**

Run: `npx tsc --noEmit`
Expected: exit 0. Any caller of `trpc.project.setDefaultPipeline` will fail — that's expected; the caller in `settings/page.tsx` gets fixed in Task 9.

If tsc errors only on the `setDefaultPipeline` caller, proceed. If it errors anywhere else, investigate.

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

- [ ] **Step 1: Write the failing test**

This test creates two organizations and two projects. The cross-org and cross-project negative cases are the ones that previously slipped through `project.update`.

```ts
// src/__tests__/integration/project-update-fk-validation.test.ts
import { TRPCError } from '@trpc/server';
import { describe, expect, it } from 'vitest';
import { createCallerFactory } from '@/server/trpc';
import { appRouter } from '@/server/routers/_app';
import { makeTestCtx } from './helpers/ctx';
import {
  insertOrg,
  insertProject,
  insertUser,
  insertPipeline,
  insertBrand,
} from './helpers/fixtures';

const createCaller = createCallerFactory(appRouter);

describe('project.update FK validation (FLX-228, FLX-229)', () => {
  it('rejects defaultPipelineId from a different project', async () => {
    const ctx = await makeTestCtx();
    const caller = createCaller(ctx);
    const orgA = await insertOrg(ctx.db, 'fk-org-a');
    const userA = await insertUser(ctx.db, orgA.id, 'fk-user-a');
    const projectA = await insertProject(ctx.db, orgA.id, userA.id, 'fk-proj-a');
    const projectB = await insertProject(ctx.db, orgA.id, userA.id, 'fk-proj-b');
    const otherProjectPipeline = await insertPipeline(
      ctx.db,
      projectB.id,
      'fk-pipe-b'
    );

    await expect(
      caller.project.update({
        id: projectA.id,
        defaultPipelineId: otherProjectPipeline.id,
      })
    ).rejects.toMatchObject({
      message: 'PIPELINE_NOT_IN_PROJECT',
    });
  });

  it('accepts defaultPipelineId from the same project', async () => {
    const ctx = await makeTestCtx();
    const caller = createCaller(ctx);
    const org = await insertOrg(ctx.db, 'fk-org-c');
    const user = await insertUser(ctx.db, org.id, 'fk-user-c');
    const proj = await insertProject(ctx.db, org.id, user.id, 'fk-proj-c');
    const pipe = await insertPipeline(ctx.db, proj.id, 'fk-pipe-c');

    await caller.project.update({
      id: proj.id,
      defaultPipelineId: pipe.id,
    });

    const after = await caller.project.getById({ id: proj.id });
    expect(after?.defaultPipelineId).toBe(pipe.id);
  });

  it('accepts defaultPipelineId: null', async () => {
    const ctx = await makeTestCtx();
    const caller = createCaller(ctx);
    const org = await insertOrg(ctx.db, 'fk-org-d');
    const user = await insertUser(ctx.db, org.id, 'fk-user-d');
    const proj = await insertProject(ctx.db, org.id, user.id, 'fk-proj-d');
    const pipe = await insertPipeline(ctx.db, proj.id, 'fk-pipe-d');
    await caller.project.update({
      id: proj.id,
      defaultPipelineId: pipe.id,
    });

    await caller.project.update({
      id: proj.id,
      defaultPipelineId: null,
    });

    const after = await caller.project.getById({ id: proj.id });
    expect(after?.defaultPipelineId).toBeNull();
  });

  it('rejects brandId from a different org', async () => {
    const ctx = await makeTestCtx();
    const caller = createCaller(ctx);
    const orgA = await insertOrg(ctx.db, 'fk-brand-org-a');
    const orgB = await insertOrg(ctx.db, 'fk-brand-org-b');
    const userA = await insertUser(ctx.db, orgA.id, 'fk-brand-user-a');
    const projectA = await insertProject(
      ctx.db,
      orgA.id,
      userA.id,
      'fk-brand-proj-a'
    );
    const otherOrgBrand = await insertBrand(
      ctx.db,
      orgB.id,
      'fk-brand-other-org'
    );

    await expect(
      caller.project.update({
        id: projectA.id,
        brandId: otherOrgBrand.id,
      })
    ).rejects.toMatchObject({
      message: 'BRAND_NOT_IN_ORG',
    });
  });

  it('accepts brandId from the same org', async () => {
    const ctx = await makeTestCtx();
    const caller = createCaller(ctx);
    const org = await insertOrg(ctx.db, 'fk-brand-org-c');
    const user = await insertUser(ctx.db, org.id, 'fk-brand-user-c');
    const proj = await insertProject(
      ctx.db,
      org.id,
      user.id,
      'fk-brand-proj-c'
    );
    const br = await insertBrand(ctx.db, org.id, 'fk-brand-same-org');

    await caller.project.update({
      id: proj.id,
      brandId: br.id,
    });

    const after = await caller.project.getById({ id: proj.id });
    expect(after?.brandId).toBe(br.id);
  });
});
```

**Note:** Before writing the actual file, check the existing fixture helpers in `src/__tests__/integration/helpers/` — function names, signatures, and import paths must match. If `insertBrand` doesn't exist, add a minimal one (consistent with the other `insertX` helpers).

- [ ] **Step 2: Adapt to actual fixture helpers**

Run: `ls src/__tests__/integration/helpers/`
Run: `grep -n "export function insert" src/__tests__/integration/helpers/*.ts`

Adjust the imports and call signatures in the test file to match the real helpers. If `insertBrand` is missing, add it to the appropriate helper file with this minimum:

```ts
import { brand } from '@/core/db/schema';
// ...
export async function insertBrand(db: Database, orgId: string, name: string) {
  const [row] = await db
    .insert(brand)
    .values({ orgId, name, slug: name })
    .returning();
  return row;
}
```

(Check `brand` schema for required columns — slug may be required; the exact shape is in `src/core/db/schema.ts` around line 828.)

- [ ] **Step 3: Run the suite**

Run: `set -a; source .env; source .env.local; set +a; npx vitest run src/__tests__/integration/project-update-fk-validation.test.ts`
Expected: 5/5 pass.

- [ ] **Step 4: Commit**

```bash
git add src/__tests__/integration/project-update-fk-validation.test.ts src/__tests__/integration/helpers/
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
  if (field.fieldType === 'select-id') {
    const options = field.selectIdOptions ?? [];
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

## Task 14: Mount `ConfirmModalHost` at the app root

**Files:**
- Modify: `src/app/layout.tsx`

- [ ] **Step 1: Inspect the layout file**

Run: `cat src/app/layout.tsx | head -50`

The host must mount inside the providers tree (not outside, or `useEffect` won't fire on the client). Add `<ConfirmModalHost />` adjacent to other client-side overlay providers.

- [ ] **Step 2: Add the mount**

Add the import:

```ts
import { ConfirmModalHost } from '@/components/confirm-modal';
```

Inside the `<body>` (or its top-level client provider), add `<ConfirmModalHost />` as a sibling to the page content. Place it last so it overlays correctly.

If the layout is a server component that wraps a client `<Providers>` component, add the host inside `<Providers>`. If unsure, check whether `<Providers>` exists and place it there; otherwise inside `<body>` after `{children}`.

- [ ] **Step 3: Verify compile and run dev**

Run: `npx tsc --noEmit`
Expected: exit 0

Smoke-check by starting the dev server and opening any page — the modal should not appear, but the page should load (proves the host doesn't break SSR).

Run: `./flux server dev restart`
Then: `curl -s -o /dev/null -w "HTTP %{http_code}\n" http://localhost:3004/`
Expected: HTTP 200 or 307.

- [ ] **Step 4: Commit**

```bash
git add src/app/layout.tsx
git commit -m "feat: mount ConfirmModalHost at the app root (FLX-226)"
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

- [ ] **Step 1: Inspect an existing settings spec for patterns**

Run: `ls e2e/`
Run: `grep -l "settings/projects" e2e/*.spec.ts || true`
Read one or two existing specs to match the project's test patterns (auth bypass, page navigation, `data-testid` conventions).

- [ ] **Step 2: Write the spec**

```ts
// e2e/settings-projects-form-slice.spec.ts
import { expect, test } from '@playwright/test';

// FLX-207 / FLX-226 / FLX-227 / FLX-229 journey. Exercises the full
// Projects form lifecycle: dropdown selections, repoUrl validate,
// slug rename confirm + redirect.
//
// Targets the dev server seeded with the canonical org/user/project
// (default seed creates one of each). FLUXAOS_LAN_AUTH_BYPASS=1 must
// be set on the server (already required by other e2e specs).

const ORG = 'default';      // adjust if your seed slugs differ
const USER = 'default';
const PROJECT = 'fluxaos';
const RENAMED_PROJECT = 'fluxaos-renamed';

test.describe('Projects form slice', () => {
  test('full form lifecycle', async ({ page }) => {
    await page.goto(`/${ORG}/${USER}/${PROJECT}/settings/projects`);

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
    await page.goto(`/${ORG}/${USER}/${PROJECT}/settings/projects`);
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

  test('slug rename — cancel keeps current slug', async ({ page }) => {
    await page.goto(`/${ORG}/${USER}/${PROJECT}/settings/projects`);
    await page.getByRole('button', { name: /^Edit$/i }).first().click();

    const slugInput = page.getByLabel('Slug', { exact: true });
    await slugInput.fill(RENAMED_PROJECT);
    await page.getByRole('button', { name: /^Save$/i }).click();

    // Confirm modal appears.
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.getByRole('button', { name: /Cancel/i }).click();

    // URL did not change.
    await expect(page).toHaveURL(
      new RegExp(`/${ORG}/${USER}/${PROJECT}/settings/projects$`)
    );
  });

  test('slug rename — confirm redirects to new slug', async ({ page }) => {
    // This case mutates seeded data. Rename, assert redirect, then rename back.
    await page.goto(`/${ORG}/${USER}/${PROJECT}/settings/projects`);
    await page.getByRole('button', { name: /^Edit$/i }).first().click();

    const slugInput = page.getByLabel('Slug', { exact: true });
    await slugInput.fill(RENAMED_PROJECT);
    await page.getByRole('button', { name: /^Save$/i }).click();
    await page.getByTestId('confirm-modal-confirm').click();

    await expect(page).toHaveURL(
      new RegExp(`/${ORG}/${USER}/${RENAMED_PROJECT}/settings/projects$`)
    );

    // Rename back so the next test run starts clean.
    await page.getByRole('button', { name: /^Edit$/i }).first().click();
    await slugInput.fill(PROJECT);
    await page.getByRole('button', { name: /^Save$/i }).click();
    await page.getByTestId('confirm-modal-confirm').click();
    await expect(page).toHaveURL(
      new RegExp(`/${ORG}/${USER}/${PROJECT}/settings/projects$`)
    );
  });
});
```

**Note on selectors:** The exact text of the Edit/Save buttons depends on RecordEditor's existing UI. Before running, open the form in the browser and confirm the button names match. Adjust `getByRole('button', { name: ... })` patterns as needed.

**Note on ORG/USER/PROJECT slugs:** the seed uses specific values. Run `npm run db:issues` or inspect the seed to confirm. Adjust the constants at the top of the spec if they differ.

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

No further issues. Plan complete.
