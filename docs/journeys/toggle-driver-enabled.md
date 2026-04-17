<!-- docs/journeys/toggle-driver-enabled.md -->
---
id: toggle-driver-enabled
tags: [r-ui-1, settings, drivers]
feature: R-UI-1
---

# Journey: toggle-driver-enabled

## Steps

1. Navigate to `Settings → Drivers`
2. Locate the "Claude Code" row
3. Toggle its enabled switch OFF
4. Reload the page
5. Verify the toggle is OFF
6. Toggle it back ON
7. Reload the page
8. Verify the toggle is ON

## Expected outcome

The `isEnabled` flag persists across reloads. Version bumps twice.
