# Journey Index

| Slug | What it covers | Tags | Spec |
|---|---|---|---|
| [edit-a-driver](edit-a-driver.md) | Edit a driver's fields and save | `@r-ui-1` `@settings` `@drivers` `@crud` | `e2e/edit-a-driver.spec.ts` |
| [toggle-driver-enabled](toggle-driver-enabled.md) | Toggle a driver on/off and verify persistence | `@r-ui-1` `@settings` `@drivers` | `e2e/toggle-driver-enabled.spec.ts` |
| [edit-a-skill](edit-a-skill.md) | Edit a skill's fields and save | `@r-ui-1` `@settings` `@skills` `@crud` | `e2e/edit-a-skill.spec.ts` |
| [delete-an-unreferenced-skill](delete-an-unreferenced-skill.md) | Create → select → delete a skill with no references | `@r-ui-1` `@settings` `@skills` `@crud` | `e2e/delete-an-unreferenced-skill.spec.ts` |
| [delete-a-referenced-skill-fails-gracefully](delete-a-referenced-skill-fails-gracefully.md) | Attempt to delete a skill with references; verify FK error message | `@r-ui-1` `@settings` `@skills` | `e2e/delete-a-referenced-skill-fails-gracefully.spec.ts` |
| [conflict-on-save](conflict-on-save.md) | Two tabs save the same record; second save fails with conflict toast | `@r-ui-1` `@settings` `@concurrency` | `e2e/conflict-on-save.spec.ts` |

## Running journeys

```bash
# All R-UI-1 journeys
npx playwright test --grep @r-ui-1

# Just CRUD journeys
npx playwright test --grep @crud

# One by name
npx playwright test edit-a-driver
```

## Authoring a journey

Every journey has a plain-English Markdown story and a matching `.spec.ts` test. The test is a one-to-one translation of the story's numbered steps. Slug-based IDs, not numbered — slugs are stable through inserts and deletes.
