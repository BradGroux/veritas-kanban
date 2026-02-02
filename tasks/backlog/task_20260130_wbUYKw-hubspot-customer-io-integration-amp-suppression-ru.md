---
id: task_20260130_wbUYKw
title: HubSpot ↔ Customer.io Integration &amp; Suppression Rules
type: sales
status: todo
priority: high
project: digital-meld
sprint: Sales-Funnel
created: '2026-01-30T10:15:27.828Z'
updated: '2026-01-30T10:15:27.828Z'
---

**Goal:** Connect HubSpot and Customer.io with proper data flow and suppression rules so contacts never get double-messaged.
**Owner:** Robert (technical) + Brad (strategy)
**Effort:** M (6-8 hours)

**Acceptance Criteria:**

- Data flowing HubSpot → Customer.io (contact properties, lifecycle stage changes, deal stage changes)
- Selective data flowing Customer.io → HubSpot (engagement score, key conversions, 'highly engaged' flags)
- Suppression rule active: `in_sales_sequence = true` in Customer.io suppresses all marketing campaigns
- Unsubscribes honored bidirectionally
- Handoff trigger working: MQL in HubSpot → pause Customer.io campaigns

**Subtasks:**

1. Evaluate integration options — Customer.io native HubSpot integration vs. Zapier vs. custom API — select approach based on Startup plan capabilities (2h) — Ref: Customer.io Guide §9, Technical Integration Options
2. Configure HubSpot → Customer.io sync: contact properties (industry, revenue, employee count, temperature, lifecycle stage), deal stage changes for customers, sync frequency (real-time or 15-min for lifecycle, daily batch for engagement) (2h) — Ref: Customer.io Guide §9, Recommended Data Flow + §1, Data Sync Strategy
3. Configure Customer.io → HubSpot selective sync: engagement score → HubSpot custom property, assessment booked → HubSpot task, 'highly engaged' flag → HubSpot notification (2h) — Ref: Customer.io Guide §9
4. Verify suppression: test that setting `in_sales_sequence = true` in HubSpot properly suppresses Customer.io campaigns, verify unsubscribe in Customer.io reflects in HubSpot and vice versa (1h) — Ref: Customer.io Guide §9, Avoiding Duplicate Sends
5. Document the integration rules: Source of Truth table (contact info = HubSpot, email engagement = Customer.io, deals = HubSpot), handoff triggers, suppression rules — share with team (1h) — Ref: Customer.io Guide §1, Data Sync Strategy table
