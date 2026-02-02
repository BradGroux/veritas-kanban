---
id: task_20260130_tzQyBx
title: 'HubSpot Data Architecture: Custom Properties, Lifecycle Stages &amp; Lists'
type: sales
status: todo
priority: high
project: digital-meld
sprint: Sales-Funnel
created: '2026-01-30T10:15:27.700Z'
updated: '2026-01-30T10:15:27.700Z'
---

**Goal:** Build the contact data model that enables segmentation, scoring, and pipeline tracking.
**Owner:** Mark + Brad
**Effort:** M (8-10 hours)

**Acceptance Criteria:**

- All 14 custom contact properties created (Lead Temperature, Service Interest, Company Size, IT Team Size, Has CIO/CTO, Growth Mode, Assessment Offered/Status, Pain Point, Decision Timeline, Budget Authority, etc.)
- Lifecycle stages configured with advancement rules
- Lead Status values configured (New through Closed Won/Lost)
- Core segmented lists built (Cold, Warm, ICP fit, by Service Interest, by Engagement)

**Subtasks:**

1. Create 'Digital Meld Qualification' property group + all 14 custom contact properties with dropdowns/checkboxes per spec (3h) — Ref: HubSpot Guide §2, Custom Properties table
2. Configure lifecycle stages (Subscriber → Lead → MQL → SQL → Opportunity → Customer → Evangelist → Other) with entry/exit definitions (2h) — Ref: HubSpot Guide §2, Lifecycle Stages
3. Configure Lead Status values (New, Open, Attempted, Connected, In Progress, Open Deal, Unqualified, Bad Timing, Closed Won, Closed Lost) (1h) — Ref: HubSpot Guide §2, Lead Status
4. Build segmented lists — by Temperature (Cold/Warm/Active), by ICP Fit (revenue $100-250M + no CTO + growth mode), by Service Interest (AI, Microsoft, Security), by Engagement (active vs. disengaged) (3h) — Ref: HubSpot Guide §2, Contact Segmentation
5. Document data entry standards for team — required fields on contact creation, note-taking format, activity logging rules (2h) — Ref: HubSpot Guide §2, Data Entry Standards
