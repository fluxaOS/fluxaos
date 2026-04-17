<!-- docs/journeys/conflict-on-save.md -->
---
id: conflict-on-save
tags: [r-ui-1, settings, concurrency]
feature: R-UI-1
---

# Journey: conflict-on-save

## Steps

1. Open two browser contexts, A and B
2. In both, navigate to `Settings → Skills` and click the "research" row
3. In both, click "Edit" — both tabs now hold the same `version` N
4. In tab A, change Description to `A-change`
5. In tab A, click "Save" — expect success
6. In tab B, change Description to `B-change`
7. In tab B, click "Save" — expect an error banner with text matching `updated elsewhere` or `conflict`
8. In tab B, click "Cancel"
9. Refresh tab B; click "research"; verify description reads `A-change`

## Expected outcome

Second writer gets the conflict banner with their draft preserved; first writer's change wins.
