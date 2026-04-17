<!-- docs/journeys/edit-a-skill.md -->
---
id: edit-a-skill
tags: [r-ui-1, settings, skills, crud]
feature: R-UI-1
---

# Journey: edit-a-skill

## Steps

1. Navigate to `Settings → Skills`
2. Verify the list shows `research`, `implement`, `review`, `rework`, `deploy`
3. Click the "research" row
4. Click "Edit"
5. Change the "Description" field to `journey: edit-a-skill ran at {timestamp}`
6. Click "Save"
7. Verify the panel returns to read-only view and shows the new description
8. Reload the page, click "research", verify description persisted

## Expected outcome

The skill's `description` persists across reloads. `version` increments.
