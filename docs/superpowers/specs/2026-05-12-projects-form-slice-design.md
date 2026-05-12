# Projects form slice — design

**Date:** 2026-05-12
**Linear issues:** FLX-207, FLX-226, FLX-227, FLX-228, FLX-229 (children of FLX-209)
**Related (filed during brainstorm):** FLX-239 (tenancy model brainstorm — separate epic, does NOT block this slice)

## Purpose

The project edit form at `/[org]/[user]/[project]/settings/projects` is the operator's single entry point for changing how a project runs: which git repo it tracks, which pipeline it defaults to, which brand it inherits, where its working clone lives. Today the form has three concrete defects:

1. Two fields (`defaultPipelineName`, `targetRepoPath`) render as styled inputs but are silently readonly. No visual cue distinguishes them from editable fields.
2. The brand selector lives outside the form in a second `<section>` that calls `project.update` directly, creating two mutation paths on one page.
3. The router accepts cross-project pipeline IDs, malformed repo URLs, and slug renames with no validation, no confirmation, and no redirect — every one of which silently breaks invariants the rest of the codebase depends on.

This spec covers a single coordinated slice that makes every visible field editable, makes the readonly visual treatment unmistakable across every RecordEditor consumer, consolidates the brand mutation into the form, and adds the three missing validations (FK scope, URL liveness, slug rename safety). It does not change the data model and does not touch tenancy.

## Principles applied

This slice is the first to be designed under the operator-stated principles for fluxaOS work going forward:

- **Modular** — each new capability lands as one well-bounded primitive.
- **Config-driven, nothing hardcoded** — vendor names, hostnames, and FK rules are data or adapter properties, never literals in form/router code.
- **DRY** — one mutation per table, one place per invariant, one knob per concern.
- **Vendor/tool agnostic at every layer** — the form, the page, the router, and the service never reference "github." Only the GitHub provider adapter does.
- **All variables DB-stored except bootstrap** — credentials remain env-only (bootstrap); everything else is data or adapter-resident.
- **Layer ignorance** — RecordField knows nothing about projects, project.update knows nothing about git providers, the git router knows nothing about HTTP.

These properties are not aspirational; the design rejects any option that violates them.

## Scope

| Linear | Lands in this slice |
|--------|--|
| FLX-207 | Every visible field editable; readonly fields visually distinct (refresh applies app-wide) |
| FLX-226 | Slug rename = confirm modal + `router.replace` redirect; regex `^[a-z0-9-]+$` enforced server-side |
| FLX-227 | Two-step Validate/Save UX; shape check → vendor-agnostic git-router `validate()` → adapter API liveness |
| FLX-228 | Generalized FK self-validation in `project.update`; `setDefaultPipeline` deleted |
| FLX-229 | Brand selector moved into the form as a `select-id` field; the second `<section>` deleted |

Out of scope (filed elsewhere):

- Tenancy model redesign (FLX-239).
- `RecordEditor` save-layer enforcement of `readonly` (cosmetic-only today; tracked separately if needed).
- Persisting target-repo-path validation (no live filesystem check from the web tier — would require a daemon round-trip; not in this slice).
- Parsing `repoUrl` into separate `owner`/`repo` columns.

## Architecture

Five layers, each ignorant of the ones below it.

```
┌─ Projects page ────────────────────────────────────────────────────────────┐
│  src/app/[org]/[user]/[project]/settings/projects/page.tsx                 │
│  - One mutation site: RecordEditor → project.update                        │
│  - Loads dropdown options (pipelines, brands) and feeds them to the        │
│    descriptor at render time                                               │
│  - Hosts the slug confirm modal + router.replace redirect                  │
│  - Hosts the repoUrl two-step Validate UI via a custom field renderer      │
└────────────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌─ RecordEditor primitive ───────────────────────────────────────────────────┐
│  src/components/record-editor/                                             │
│  - New field type: select-id (renders label, saves value, optional null)   │
│  - Readonly visual refresh (muted bg + label suffix + cursor)              │
│  - New field property: customRenderer (a generic escape hatch)             │
│  - Knows NOTHING about projects/pipelines/brands                           │
└────────────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌─ tRPC project router ──────────────────────────────────────────────────────┐
│  src/server/routers/project.ts                                             │
│  - project.update is THE mutation; validateRepoUrl is its companion        │
│  - Service-layer FK_VALIDATORS map: one entry per FK, registered once      │
│  - setDefaultPipeline is DELETED                                           │
│  - Knows NOTHING about which git provider is in use                        │
└────────────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌─ Git router ───────────────────────────────────────────────────────────────┐
│  src/adapters/git-router/                                                  │
│  - validate(url) walks registered providers; first host match owns         │
│  - Knows NOTHING about HTTP — pure adapter orchestration                   │
└────────────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌─ Git provider adapters ────────────────────────────────────────────────────┐
│  src/adapters/git-router/providers/<vendor>.ts                             │
│  - github.ts today: supportedHosts, parse(url), exists(coords)             │
│  - Future: gitlab.ts, forgejo.ts — drop in, self-register                  │
│  - Each adapter knows its OWN vendor; nothing else does                    │
└────────────────────────────────────────────────────────────────────────────┘
```

Boundary properties:

- **RecordField never knows what entity it's selecting.** `select-id` accepts `{value, label}[]` plus optional `nullOptionLabel`. That's it.
- **`project.update` never knows what git provider is involved.** It calls `gitRouter.validate(url)`.
- **The page never imports a specific provider.** It calls `trpc.project.validateRepoUrl.mutate({url})`.
- **Pipelines tab's "Set as default" button** calls `project.update({defaultPipelineId})`. Mutation choice is per-table, not per-field.

## Data model

### Schema changes

**None.** The DB already supports everything: `defaultPipelineId`, `brandId`, `targetRepoPath`, `repoUrl` are nullable columns on `project`. The slice is pure tRPC + UI.

### `select-id` field type

In `src/components/record-editor/types.ts`:

```ts
export type FieldType =
  | 'text' | 'textarea' | 'textarea-large' | 'tags'
  | 'boolean' | 'jsonb' | 'select' | 'select-id'   // ← new
  | 'readonly';

export type SelectIdOption = {
  /** UUID written to the record */
  value: string;
  /** Human-readable label shown in the dropdown */
  label: string;
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

  /** For fieldType: 'select' — literal string enums (unchanged) */
  options?: readonly string[];

  /** For fieldType: 'select-id' — FK lookups: render label, save value */
  selectIdOptions?: readonly SelectIdOption[];

  /** For fieldType: 'select-id' — label of the null/empty choice. Omit
   *  to force a non-null selection (no leading null option). */
  nullOptionLabel?: string;

  /** Generic escape hatch — used by repoUrl for the two-step Validate UX.
   *  When set, RecordField defers to this renderer. */
  customRenderer?: (props: CustomRendererProps<TRecord>) => ReactNode;
};
```

`select-id` is its own branch in `RecordField.tsx` — a `<select>` rendering `<option value={value}>{label}</option>` and, when `nullOptionLabel` is set, prepending `<option value="">{nullOptionLabel}</option>` mapping to `null`.

### Updated `ProjectRecord`

```ts
export type ProjectRecord = {
  id: string;
  version: number;
  name: string;
  slug: string;
  repoUrl: string | null;
  defaultBranch: string;
  defaultPipelineId: string | null;   // replaces UI-only defaultPipelineName
  brandId: string | null;             // moves in from the deleted side-channel
  targetRepoPath: string | null;
};
```

`buildProjectDescriptor({pipelineOptions, brandOptions, repoUrlRenderer})` is a factory in `descriptor.ts` — keeps static descriptor fields close to their declaration while accepting dynamic options at call time.

### Readonly visual treatment (RecordField.tsx)

The `readonly` branch updates to make non-interactivity unmistakable. Concrete treatment:

- Background: `bg-slate-900/30` (lighter than the editable `bg-slate-900`).
- Border: dashed instead of solid, color `border-slate-700/40`.
- Label suffix: `(read-only)` rendered as muted text inline with the field label.
- Cursor: `not-allowed` on hover.
- No focus ring (already absent — codified).

The visual update applies to every RecordEditor consumer in the app. The Projects form has zero readonly fields post-slice, but other forms (e.g., timestamps, version) benefit.

## tRPC layer

### `project.update` — input

```ts
update: protectedMutation(EDIT_ROLES)
  .input(
    z.object({
      id: z.string().uuid(),
      name: z.string().min(1).optional(),
      slug: z.string().min(1).regex(/^[a-z0-9-]+$/).optional(),
      repoUrl: z.string().url().nullable().optional(),
      defaultBranch: z.string().min(1).optional(),
      defaultPipelineId: z.string().uuid().nullable().optional(),
      brandId: z.string().uuid().nullable().optional(),
      targetRepoPath: z.string().nullable().optional(),
    })
  )
  .mutation(async ({ ctx, input }) => {
    const { id, ...patch } = input;
    return createProjectService(ctx.db).update(id, patch);
  }),
```

### Service-layer FK validation

```ts
// src/core/services/project-service.ts (sketch)

type FkValidator = (db: Database, projectId: string, value: unknown) => Promise<void>;

const FK_VALIDATORS: Record<string, FkValidator> = {
  defaultPipelineId: async (db, projectId, value) => {
    if (value == null) return;
    const pipe = await getPipelineById(db, value as string);
    if (!pipe) throw new TRPCError({ code: 'NOT_FOUND', message: 'PIPELINE_NOT_FOUND' });
    if (pipe.projectId !== projectId)
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'PIPELINE_NOT_IN_PROJECT' });
  },
  brandId: async (db, projectId, value) => {
    if (value == null) return;
    const proj = await getProjectById(db, projectId);
    const br = await getBrandById(db, value as string);
    if (!br) throw new TRPCError({ code: 'NOT_FOUND', message: 'BRAND_NOT_FOUND' });
    if (br.orgId !== proj.orgId)
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'BRAND_NOT_IN_ORG' });
  },
  // Future FKs add one entry here. Writer code never changes.
};

async function update(id: string, patch: Partial<Project>) {
  for (const key of Object.keys(patch)) {
    const validator = FK_VALIDATORS[key];
    if (validator) await validator(db, id, (patch as Record<string, unknown>)[key]);
  }
  if ('repoUrl' in patch && patch.repoUrl != null) {
    const result = await gitRouter.validate(patch.repoUrl as string);
    if (!result.ok) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `REPO_URL_${result.reason}`,
        cause: result,
      });
    }
  }
  return writeProject(db, id, patch);
}
```

The `FK_VALIDATORS` map is the single registration point. Adding `defaultModelId`, `defaultDriverId`, or any future FK = one entry, no writer change.

### `setDefaultPipeline` — deleted

- Router endpoint removed.
- Pipelines tab's "Set as default" button calls `trpc.project.update.mutate({ id, defaultPipelineId })`.
- E2E specs and any other consumers updated in the same PR.

### `project.validateRepoUrl` — new endpoint

For the form's two-step Validate button:

```ts
validateRepoUrl: protectedMutation(EDIT_ROLES)
  .input(z.object({ url: z.string().url() }))
  .mutation(async ({ input }) => {
    return gitRouter.validate(input.url);
  }),
```

A `mutation` (not a query) so it isn't prefetched or cached — the operator clicks Validate, server hits the provider once, returns the result.

`project.update` re-runs the same validation on save (above). The client cannot bypass it; the validation can fail at save even after a green check at validate (repo deleted, token revoked) and the form surfaces that.

### Error message keys

Stable keys returned in `TRPCError.message`:

| Domain | Key |
|--|--|
| FK | `PIPELINE_NOT_FOUND`, `PIPELINE_NOT_IN_PROJECT`, `BRAND_NOT_FOUND`, `BRAND_NOT_IN_ORG` |
| Repo URL | `REPO_URL_INVALID_URL`, `REPO_URL_UNSUPPORTED_HOST`, `REPO_URL_REPO_NOT_FOUND`, `REPO_URL_AUTH_FAILED`, `REPO_URL_NETWORK` |
| Slug | (handled by zod regex; surfaces as Zod validation error) |

The page owns the user-facing copy table that maps keys to messages — vendor-agnostic on the wire, operator-friendly in the UI.

## Git router & adapter contract

### Adapter type

`src/adapters/git-router/types.ts`:

```ts
export type RepoCoordinates = {
  owner: string;
  repo: string;
};

export type ValidationFailureReason =
  | 'INVALID_URL'         // shape didn't parse
  | 'UNSUPPORTED_HOST'    // host has no registered adapter
  | 'REPO_NOT_FOUND'      // adapter ran; repo isn't reachable
  | 'AUTH_FAILED'         // credentials missing/expired
  | 'NETWORK';            // upstream unreachable

export type ValidationResult =
  | { ok: true;  provider: string;       coords: RepoCoordinates }
  | { ok: false; provider: string | null; reason: ValidationFailureReason; detail?: string };

export interface GitProviderAdapter {
  readonly key: string;
  readonly supportedHosts: readonly string[];
  parse(url: URL): RepoCoordinates | null;
  exists(coords: RepoCoordinates): Promise<boolean>;
}
```

### Router

`src/adapters/git-router/router.ts`:

```ts
export class GitRouter {
  constructor(private adapters: readonly GitProviderAdapter[]) {}

  async validate(rawUrl: string): Promise<ValidationResult> {
    let url: URL;
    try { url = new URL(rawUrl); }
    catch { return { ok: false, provider: null, reason: 'INVALID_URL' }; }

    const adapter = this.adapters.find(a => a.supportedHosts.includes(url.hostname));
    if (!adapter) return { ok: false, provider: null, reason: 'UNSUPPORTED_HOST' };

    const coords = adapter.parse(url);
    if (!coords) return { ok: false, provider: adapter.key, reason: 'INVALID_URL' };

    try {
      const found = await adapter.exists(coords);
      return found
        ? { ok: true, provider: adapter.key, coords }
        : { ok: false, provider: adapter.key, reason: 'REPO_NOT_FOUND' };
    } catch (err) {
      if (isAuthError(err))    return { ok: false, provider: adapter.key, reason: 'AUTH_FAILED', detail: String(err) };
      if (isNetworkError(err)) return { ok: false, provider: adapter.key, reason: 'NETWORK',     detail: String(err) };
      throw err;
    }
  }
}
```

### Registration

`src/adapters/git-router/registry.ts`:

```ts
import { gitHubProvider } from './providers/github';

export function buildGitRouter(env: AdapterEnv): GitRouter {
  return new GitRouter([
    gitHubProvider({ token: env.FLUXAOS_GITHUB_TOKEN }),
    // gitLabProvider({ token: env.FLUXAOS_GITLAB_TOKEN }),          // future
    // forgejoProvider({ token: env.FLUXAOS_FORGEJO_TOKEN,
    //                   host:  env.FLUXAOS_FORGEJO_HOST }),         // future
  ]);
}
```

Adding a vendor = one new file + one new line + (if needed) one new env var. No other change.

### GitHub adapter

`src/adapters/git-router/providers/github.ts`:

```ts
export function gitHubProvider({ token }: { token: string }): GitProviderAdapter {
  return {
    key: 'github',
    supportedHosts: ['github.com', 'www.github.com'],

    parse(url) {
      const m = url.pathname.match(/^\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/);
      if (!m) return null;
      return { owner: m[1], repo: m[2] };
    },

    async exists({ owner, repo }) {
      const res = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
        headers: {
          'Authorization':         `Bearer ${token}`,
          'Accept':                'application/vnd.github+json',
          'X-GitHub-Api-Version':  '2022-11-28',
        },
      });
      if (res.status === 404) return false;
      if (res.status === 401 || res.status === 403) throw new AuthError(res.statusText);
      if (!res.ok) throw new NetworkError(`GitHub ${res.status}`);
      return true;
    },
  };
}
```

### Migration from existing `git-router/factory.ts`

A `git-router/factory.ts` exists today (per FLX-218) that dispatches by host-key only — no liveness check. The slice renames it to `registry.ts` and folds its behavior in: the existing "fail fast on unknown host" path becomes the `UNSUPPORTED_HOST` reason in `GitRouter.validate()`. Existing consumers (`stage-runner-env`, `deploy-bridge`, `worktree-isolation-provider`) continue using whatever they use; the `validate()` path is purely additive.

## Page UX

### Slug rename — confirm + redirect

```ts
const onSave = async (id, patch, expectedVersion) => {
  if ('slug' in patch && patch.slug !== currentProject.slug) {
    const confirmed = await openConfirmModal({
      title:        'Rename project slug?',
      body:         'Renaming the project slug invalidates all existing URLs and bookmarks for this project. Continue?',
      confirmLabel: 'Rename',
      destructive:  true,
    });
    if (!confirmed) return;  // RecordEditor stays in edit mode, no save
  }

  await updateMutation.mutateAsync({ id, ...patch });
  await utils.project.list.invalidate();

  if (patch.slug && patch.slug !== params.project) {
    router.replace(`/${params.org}/${params.user}/${patch.slug}/settings/projects`);
  }
};
```

`openConfirmModal` is a generic promise-based modal primitive at `src/components/confirm-modal/`. It has no project-specific knowledge.

Shape check (`^[a-z0-9-]+$`) runs in zod on the server (authoritative). The field's client-side `validate` callback runs the same regex so the operator sees the error before submitting.

### Repo URL — two-step Validate / Save

The form uses `customRenderer` on the `repoUrl` descriptor field to wrap the standard text input with a Validate button + result strip:

```
┌─────────────────────────────────────────────────────────────┐
│  Repo URL                                                   │
│  ┌─────────────────────────────────────────┐ ┌──────────┐  │
│  │ https://github.com/owner/repo           │ │ Validate │  │
│  └─────────────────────────────────────────┘ └──────────┘  │
│  ✓ Verified · github · owner/repo                           │
│  (or)                                                       │
│  ✗ Repository not found. Check the URL or integration       │
│    access.                                                  │
└─────────────────────────────────────────────────────────────┘
                                              ┌──────┐ ┌────────┐
                                              │ Save │ │ Cancel │
                                              └──────┘ └────────┘
```

Rules:

- **Save** is enabled only when validation succeeded for the *current* value, OR the value is unchanged from persisted, OR the value is blank (`repoUrl` is optional).
- **Editing the URL** after validation clears the result and disables Save until re-validated.
- **Validate** is disabled until the URL has a valid shape (zod `.url()` client-side).
- **On save**, the server re-runs `gitRouter.validate(repoUrl)`. If it now fails, the form surfaces the new error and the save is rejected.

The renderer reports its local validity (`ok | error | null`) up to RecordEditor via the existing `onValidityChange(key, error)` hook; Save reads overall form validity from the same source.

### Brand dropdown — moved into the form

`page.tsx` lines 142–177 (the existing brand `<section>`) are **deleted in full**. The brand field renders as part of the descriptor:

```ts
{
  key:               'brandId',
  label:             'Default brand',
  fieldType:         'select-id',
  selectIdOptions:   brandOptions,             // {value,label}[] from page
  nullOptionLabel:   '(no brand)',
  helpText:          'Brand applied to issues filed under this project when none is specified.',
}
```

`brandOptions` comes from `trpc.brand.listVisibleToProject({orgId, projectId})` — same query the side-channel uses today. Org-scoped with an explicit null option.

Result: one mutation site on the whole page.

### Pipeline dropdown

```ts
{
  key:               'defaultPipelineId',
  label:             'Default pipeline',
  fieldType:         'select-id',
  selectIdOptions:   pipelineOptions,
  nullOptionLabel:   '(none)',
  helpText:          'Pipeline used when an issue does not specify one.',
}
```

The Pipelines tab's "Set as default" button updates to call `trpc.project.update.mutate({ id: projectId, defaultPipelineId: pipelineId })`. Behavior identical to today; FK validation lives in the service.

### Target repo path

Plain `text` field:

```ts
{
  key:         'targetRepoPath',
  label:       'Target repo path',
  fieldType:   'text',
  placeholder: '/mnt/dev/<owner>/<repo>',
  helpText:    "Absolute path to a local clone of this project's target repo on main. Stage runs use it to acquire an isolation worktree.",
}
```

No live filesystem check in this slice (web tier can't see the daemon's filesystem; cross-tier validation needs separate design). The stage runner already fails fast at acquire time when the path is null/invalid.

### Readonly fields after the slice

The Projects form has **zero**. Every field is editable. The `readonly` visual refresh still ships because other forms in the app DO have readonly fields (timestamps, version columns) and benefit.

## Testing strategy

### Integration tests (real Supabase, no unit tests)

`src/__tests__/integration/project-update-fk-validation.test.ts`:

- `defaultPipelineId` from another project → `PIPELINE_NOT_IN_PROJECT`.
- `brandId` from another org → `BRAND_NOT_IN_ORG`.
- `defaultPipelineId: null` → succeeds.
- Valid in-scope IDs → persist.

`src/__tests__/integration/project-validate-repo-url.test.ts`:

- Invalid shape → `INVALID_URL`.
- Valid shape, unknown host → `UNSUPPORTED_HOST`.
- GitHub URL pointing at a sentinel non-existent repo (`flux-not-a-real-org/flux-not-a-real-repo`) → `REPO_NOT_FOUND`.
- GitHub URL pointing at `fluxaOS/fluxaos` (real public repo) → `ok: true`.
- Same suite invoked through `project.update` with `repoUrl` in the patch — server-side re-validation behaves identically.

### Playwright journey (required by AGENT_BEHAVIOR.md Gate 3)

`e2e/settings-projects-form-slice.spec.ts`:

1. Loads `/[org]/[user]/[project]/settings/projects`.
2. Asserts no readonly inputs remain on the form (all inputs/selects are interactive).
3. Edits `defaultPipelineId` via dropdown, saves, asserts persistence after reload.
4. Edits `brandId` via dropdown (including selecting `(no brand)`), saves, asserts persistence.
5. Edits `repoUrl` to a known good GitHub URL, clicks Validate, asserts green check, asserts Save enabled, saves.
6. Edits `repoUrl` to garbage, clicks Validate, asserts red error, asserts Save disabled.
7. Edits `slug` to a new value, clicks Save, asserts confirm modal appears, cancels — verifies slug unchanged.
8. Repeats the slug edit, confirms the modal, asserts URL changes to new slug via `router.replace`, asserts form still shows the row.

GitHub liveness in CI: `fluxaOS/fluxaos` for the good case (public, stable); `flux-not-a-real-org/flux-not-a-real-repo` for the bad case (404 is deterministic).

## Implementation order (for the eventual plan)

1. **Adapter contract + GitHub provider + GitRouter** — new code, no existing consumers depend on it yet. Lands with its own integration test.
2. **`project.validateRepoUrl` tRPC endpoint** — wires the router. Integration test.
3. **`project.update` FK validators + repoUrl re-validation** — backend done before any UI change. Integration test for FK paths.
4. **Delete `setDefaultPipeline`** — update the Pipelines tab caller in the same commit. Integration test confirms behavior unchanged.
5. **`select-id` field type + readonly visual refresh in RecordField** — UI primitive change. Other forms benefit.
6. **`customRenderer` hook in RecordField + repoUrl renderer** — UI escape hatch.
7. **Confirm modal primitive** — generic component.
8. **Projects page rewrite** — adopt new descriptor, delete brand `<section>`, wire slug confirm + redirect, wire `customRenderer`. The deletion is large; the new code is small.
9. **Playwright journey** — final mechanical gate.

Each step is independently verifiable. The plan can split into multiple PRs along these boundaries or land as one — the writing-plans skill will decide.

## Acceptance

- Every field on `/[org]/[user]/[project]/settings/projects` is editable. (FLX-207)
- Renaming slug without confirming is impossible; after confirmed rename the operator lands on the new URL. (FLX-226)
- `repoUrl` validation rejects malformed URLs, unsupported hosts, and unreachable repos with stable error keys; valid GitHub repos persist. (FLX-227)
- `project.update` rejects FK values that are out of scope (pipeline from another project, brand from another org). `setDefaultPipeline` is gone. (FLX-228)
- `src/app/[org]/[user]/[project]/settings/projects/page.tsx` has exactly one mutation site. (FLX-229)
- A Playwright spec covers the full form round-trip and passes in the same PR as the implementation. (AGENT_BEHAVIOR.md Gate 3)
- App-wide readonly-field visual treatment is unmistakable on every RecordEditor consumer that still uses readonly fields. (FLX-207, derived benefit)

## Non-goals / explicit deferrals

- Cross-tier filesystem validation of `targetRepoPath` — needs separate design (daemon round-trip).
- Parsing `repoUrl` into `owner`/`repo` columns — runtime consumers can re-parse; no current need.
- Per-host allow-list as DB config — not needed; adapter self-registration covers it.
- Save-layer enforcement of `readonly` field type — cosmetic-only today; out of slice.
- Any change to the tenancy model — see FLX-239.
