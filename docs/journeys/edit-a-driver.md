<!-- docs/journeys/edit-a-driver.md -->
---
id: edit-a-driver
tags: [r-ui-1, settings, drivers, crud]
feature: R-UI-1
---

# Journey: edit-a-driver

**A driver in fluxaOS is the config row describing one AI CLI tool (Claude Code, Codex, Gemini CLI) and how fluxaOS invokes it. Editing a driver changes the flags/env/transport fluxaOS uses when spawning that CLI — not the CLI itself.**

## Steps

1. Navigate to `Settings → Drivers`
2. Verify the list shows the seeded "Claude Code" driver
3. Click the "Claude Code" row
4. Verify the detail panel appears with fields: Name, Slug, Binary, Model flag, Directory flag, Prompt transport, Output format
5. Click "Edit"
6. Change the "Notes" field to `journey: edit-a-driver ran at {timestamp}`
7. Click "Save"
8. Verify the detail panel returns to read-only view
9. Reload the page
10. Click "Claude Code" again
11. Verify the Notes field contains the text from step 6

## Expected outcome

The driver row's `notes` column persists the edit across a page reload, and the `version` integer has incremented by 1.
