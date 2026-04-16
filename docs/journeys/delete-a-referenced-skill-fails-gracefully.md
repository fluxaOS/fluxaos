<!-- docs/journeys/delete-a-referenced-skill-fails-gracefully.md -->
---
id: delete-a-referenced-skill-fails-gracefully
tags: [r-ui-1, settings, skills]
feature: R-UI-1
---

# Journey: delete-a-referenced-skill-fails-gracefully

## Steps

1. Navigate to `Settings → Skills`
2. Click the "research" row (seeded, referenced by pipeline stages)
3. Click "Edit"
4. Click "Delete"
5. Click "Yes, delete"
6. Verify an error banner appears with text mentioning "referenced" and at least one non-zero count
7. Verify the "research" row is STILL present in the list

## Expected outcome

The UI blocks delete with a meaningful message; the skill is preserved.
