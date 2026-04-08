---
phase: 03-personas-configuration
plan: 01b
type: execute
wave: 1
depends_on: ["03-01"]
files_modified:
  - src/__tests__/integration/setup.ts
  - src/__tests__/integration/issues.integration.test.ts
  - src/__tests__/integration/skills.integration.test.ts
  - src/__tests__/integration/personas.integration.test.ts
autonomous: true
---

<objective>
## Goal
Add integration tests hitting the real Postgres database for all three service domains (issues, skills, personas) to verify actual DB behavior.
</objective>

<context>
@src/core/issues/service.ts
@src/core/skills/service.ts
@src/core/personas/service.ts
</context>

<acceptance_criteria>
## AC-1: Integration tests prove real CRUD works
Given a running Postgres with seed data
When integration tests execute service functions against real DB
Then records are created, read, updated, and deleted successfully
And tests clean up after themselves
</acceptance_criteria>

<tasks>
<task type="auto">
  <name>Task 1: Integration test setup + all domain tests</name>
  <files>src/__tests__/integration/setup.ts, src/__tests__/integration/issues.integration.test.ts, src/__tests__/integration/skills.integration.test.ts, src/__tests__/integration/personas.integration.test.ts</files>
  <action>Create integration tests using real DB connection with cleanup</action>
  <verify>npx vitest run src/__tests__/integration/</verify>
  <done>AC-1 satisfied: real DB CRUD verified for all domains</done>
</task>
</tasks>

<output>
After completion, update 03-01-SUMMARY.md to note integration tests added.
</output>
