# Apply Bot War Room V2.14.3

Apply this cumulative patch on top of the current Bot War Room repo (or after V2.14.1/V2.14.2).

## Replace / add
- add / replace `WarRoomDashboard.tsx`
- replace `v214.css`
- replace `update-manifest.json`
- add `V2.14.3_UPDATE_NOTES.md`
- add `V2.14.3_TEST_REPORT.md`

## Why this patch is different
Previous patches only adjusted CSS selectors. This patch includes the missing dashboard component source, so the council scene and lower paper-trader block are now directly controlled by the update itself.
