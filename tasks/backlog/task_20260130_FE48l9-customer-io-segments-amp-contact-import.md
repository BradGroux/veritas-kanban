---
id: task_20260130_FE48l9
title: Customer.io Segments &amp; Contact Import
type: sales
status: todo
priority: high
project: digital-meld
sprint: Sales-Funnel
created: '2026-01-30T10:15:27.735Z'
updated: '2026-01-30T10:15:27.735Z'
---

**Goal:** Build the segment architecture and import cleaned contacts from HubSpot into Customer.io.
**Owner:** Mark (segment strategy) + Robert (import)
**Effort:** M (8-10 hours)

**Acceptance Criteria:**

- All required attributes/properties defined in Customer.io (core, service interest, engagement tracking, lifecycle)
- Segments built: by Temperature (Cold/Warm/Lead/Customer), by Service Interest (AI, Microsoft, Security, Fractional, M&amp;A), by Industry (Construction, Energy, Professional Services, Industrial), by Engagement (Active/Dormant/At-Risk), by Company Size (ICP Sweet Spot)
- Contacts imported from cleaned CSV with `import_source` and `import_date` tags
- Global suppression segment created: 'In Sales Sequence (Suppress Marketing)'

**Subtasks:**

1. Define attribute schema in Customer.io — all core attributes (email, name, company, title, temperature), service interest attributes, engagement tracking attributes, lifecycle attributes per spec (2h) — Ref: Customer.io Guide §3, Required Attributes tables
2. Build temperature segments: Cold, Warm, Lead, Customer — with engagement criteria per spec (2h) — Ref: Customer.io Guide §3, Segment Strategy - By Temperature
3. Build service interest segments (AI, Microsoft Cloud, Security, Fractional CXO, M&amp;A) + industry segments (Construction, Energy, Professional Services, Industrial Ops) (2h) — Ref: Customer.io Guide §3, By Service Interest + By Industry
4. Build engagement segments (Active: open in 30 days, Dormant: 90-180 days, At-Risk: &gt;180 days) + ICP Sweet Spot segment ($100-250M, no CTO, growth mode) (1h) — Ref: Customer.io Guide §3, By Engagement + By Company Size
5. Clean HubSpot export CSV, standardize values (temperature exact spelling, industry consistent), remove bounces/unsubscribes, import to Customer.io with `import_source = 'HubSpot initial import'` (2h) — Ref: Customer.io Guide §3, Data Import Strategy
6. Create suppression segment 'In Sales Sequence' (`in_sales_sequence = true`) to exclude from all marketing campaigns (1h) — Ref: Customer.io Guide §9, Avoiding Duplicate Sends
