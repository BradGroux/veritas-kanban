---
id: task_20260130_nFyhD-
title: 'Contact Import: Clean, Tag &amp; Import Existing Database'
type: sales
status: todo
priority: high
project: digital-meld
sprint: Sales-Funnel
created: '2026-01-30T10:15:27.718Z'
updated: '2026-01-30T10:15:27.718Z'
---

**Goal:** Get existing thousands of contacts properly tagged and imported into HubSpot with new custom properties, then sync to Customer.io.
**Owner:** Mark (data review) + Robert (technical import)
**Effort:** L (12-16 hours)

**Acceptance Criteria:**

- All existing contacts exported, cleaned, and re-imported with custom property mappings
- Duplicates merged
- Contacts tagged: Lead Temperature, Service Interest, Company Size (at minimum)
- Priority contacts (activity in last 180 days) fully enriched
- Clean CSV ready for Customer.io import

**Subtasks:**

1. Export all current HubSpot contacts to CSV backup (1h)
2. Add new columns to CSV mapping to custom properties — Lead Temperature (Cold/Warm/Lead), Service Interest, Company Size, Has CIO/CTO — prioritize contacts with activity in last 180 days (4h) — Ref: HubSpot Guide §2, Import Strategy Steps 1-2
3. Research top 50 ICP accounts on LinkedIn — fill Company Size, Has CIO/CTO, Growth Mode, IT Team Size for highest-priority contacts (4h)
4. Re-import cleaned CSV with 'Update existing contacts' — map all new columns to custom properties, verify no duplicates created (2h) — Ref: HubSpot Guide §2, Import Strategy Step 3
5. Run HubSpot dedup tool (Contacts → Manage Duplicates), merge confirmed duplicates (1h)
6. Create segmented lists immediately post-import, verify list counts match expectations (1h) — Ref: HubSpot Guide §2, Import Strategy Step 4
