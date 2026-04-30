# FLX-8 Agent-Output Brand Service Design

**Status:** Design
**Linear:** [FLX-8](https://linear.app/rebos/issue/FLX-8/post-alpha-design-brand-service)
**Date:** 2026-04-30

---

## Summary

FLX-8 activates fluxaOS's dormant brand model for runtime agent output. Operators can define brand records, attach them to personas and projects, and have the stage runner materialize the resolved brand tone and style into worker instructions. The first slice is deliberately not app theming, white labeling, logo upload, or brand asset generation.

The dogfood value is direct: when fluxaOS runs a stage against its own issues, the worker receives the product's tone and style guide as part of its execution context instead of relying on scattered prompt text or tribal memory.

## Existing Context

The schema already has the core shape:

- `brand` table with `orgId`, optional `projectId`, `name`, `colors`, `fonts`, `toneOfVoice`, `styleGuide`, and `logoUrl`.
- `persona.brandId`.
- `project.brandId`.
- `stage-runner` already reads `persona.brandId`.
- `materializer` already renders `brandToneOfVoice` and `brandStyleGuide` into the instructions file.

What is missing is the product surface and explicit runtime resolution rule. There is no brand service, tRPC router, Settings page, persona brand selector, project default selector, or test that proves project-level fallback works.

## Product Decision

Build the **agent-output brand service**.

Brand records are operator-managed runtime context. They describe how agents should write, frame decisions, refer to the product, and respect product-specific style constraints. Visual metadata such as colors, fonts, and `logoUrl` is captured for future use, but the first implementation only relies on `toneOfVoice` and `styleGuide` during materialization.

## Runtime Resolution

Brand resolution is single-pass and explicit:

1. If the stage persona has `brandId`, use that brand.
2. Otherwise, if the current project has `brandId`, use the project default brand.
3. Otherwise, inject no brand sections.

Persona brand wins because personas are the unit that expresses worker identity. Project brand is the default for unbranded personas. There is no organization fallback in FLX-8 because it would add an inheritance layer with no current operator workflow.

If a stored `brandId` points at a missing brand row, the runner should behave as unbranded for that level and continue to the next rule. Do not fail a stage because a brand link is stale; brand context improves output but is not required to execute work.

## Operator Workflow

Settings gains a Brands page under the existing project-scoped Settings navigation. Operators can:

- list brands visible to the current organization;
- create an organization-level brand;
- create a project-specific brand for the current project;
- edit brand fields;
- delete unused brands;
- attach a brand to a persona from the Personas settings page;
- attach a default brand to a project from the Projects settings page.

Deletion should be guarded by database references where possible. If a brand is still referenced by a persona or project, the UI should report the failure rather than silently clearing references.

## Data Model

FLX-8 uses the existing `brand` table. No migration is required for the first slice.

Operator-editable fields:

- `name`: required display name.
- `orgId`: required, derived from the current org context.
- `projectId`: optional, set when the brand is project-specific.
- `toneOfVoice`: optional text used in worker instructions.
- `styleGuide`: optional text used in worker instructions.
- `colors`: optional JSON object.
- `fonts`: optional JSON object.
- `logoUrl`: optional URL string.

The service should expose organization-scoped list operations and project-visible list operations. Project-visible means brands where `orgId` matches and `projectId` is either `null` or the current project id.

## Service and API Design

Add `createBrandService(db)` under `src/core/services/brand.ts`, following the DI pattern used by existing services. The service should wrap the existing CRUD factory and add:

- `listByOrg(orgId)`;
- `listVisibleToProject(orgId, projectId)`;
- `listByProject(projectId)`.

Add `brandRouter` under `src/server/routers/brand.ts` and register it in `src/server/root.ts` as `brand`.

Router operations:

- `listByOrg({ orgId })`;
- `listVisibleToProject({ orgId, projectId })`;
- `getById({ id })`;
- `create({ orgId, projectId?, name, colors?, fonts?, toneOfVoice?, styleGuide?, logoUrl? })`;
- `update({ id, name?, projectId?, colors?, fonts?, toneOfVoice?, styleGuide?, logoUrl? })`;
- `delete({ id })`.

The router should validate UUIDs and non-empty names. It should accept `null` for optional fields when the operator clears a field.

## UI Design

The Brands page should match existing Settings catalog pages: dense, operator-focused, and consistent with the current dark UI. It does not need a new visual design system.

The page should provide:

- create form;
- list of brand rows;
- edit form per row;
- text areas for tone/style;
- JSON text areas for colors/fonts, validated before save;
- logo URL text input;
- organization/project scope display.

Persona Settings should add a brand selector to create/edit flows and show the selected brand in persona details. Project Settings should add a default brand selector for each project.

## Runtime Design

Move brand resolution into a small helper near the stage runner so the rule is easy to test:

- Input: `db`, optional `personaBrandId`, and `projectBrandId`.
- Output: selected brand row or `null`.
- Rule: persona first, then project, then none.

The stage runner should load the project row in the existing stage-runner environment path or perform a narrow project lookup before materialization. It should pass the resolved brand's `toneOfVoice` and `styleGuide` to `materialize()`.

Do not pass brand colors/fonts/logo into materialized instructions in FLX-8. They are stored so future UI and generated-asset work can use them, but they are not part of the current runtime behavior.

## Tests and Verification

Required automated coverage:

- Integration test for `createBrandService`.
- Integration test for brand router CRUD.
- Integration test for runtime brand resolution:
  - persona brand wins over project brand;
  - project brand is used when persona has no brand;
  - no brand produces no tone/style sections.
- Playwright journey for Settings Brands:
  - create a brand;
  - edit tone/style;
  - attach it to a persona;
  - attach it to a project;
  - verify the saved values remain after reload.

Required verification commands:

- `npx biome check --write`
- `npm run lint`
- `npx vitest run`
- `PLAYWRIGHT_BASE_URL=http://192.168.54.101:3003 npx playwright test e2e/flx-8-brand-service.spec.ts`
- `npm run build`

## Acceptance Criteria

- Operators can create, edit, list, and delete brands from Settings.
- Operators can attach a brand to a persona.
- Operators can attach a default brand to a project.
- A stage run using a branded persona materializes brand tone and style guide into the worker instructions file.
- A stage run using an unbranded persona in a branded project materializes the project default brand tone and style guide.
- A stage run with neither persona nor project brand omits brand sections.
- The implementation stays config-driven and vendor/provider/driver agnostic.
- UI changes include a passing Playwright journey.
- Runtime behavior includes integration coverage.

## Out of Scope

- App-wide UI theme switching.
- White-label hosted pages.
- Logo upload or storage.
- Brand asset generation.
- Multiple inheritance layers beyond persona-over-project.
- External brand guideline importers.
- Hardcoded fluxaOS-specific brand defaults in core runtime code.

## Dogfood Path

Use this spec as the native fluxaOS issue body for the next self-targeted run. The worker should implement the first slice directly. If it determines a more detailed plan is needed during the research stage, it should write or update the companion implementation plan and hold for review rather than expanding scope.

FLX-7 remains separate. Do not bundle Just Do It mode into FLX-8.
