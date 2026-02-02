---
id: task_20260130_WhJb8U
title: 'Customer.io Post-Sale Journeys: Onboarding &amp; Referral'
type: sales
status: todo
priority: low
project: digital-meld
sprint: Sales-Funnel
created: '2026-01-30T10:15:27.915Z'
updated: '2026-01-30T10:15:27.915Z'
---

**Goal:** Build the automated post-sale customer journeys in Customer.io — onboarding, satisfaction check, and referral request.
**Owner:** Brad (strategy) + Robert (build)
**Effort:** M (6-8 hours)

**Acceptance Criteria:**

- Customer Onboarding Journey live: 8 emails (Welcome → Meet Your Team → Milestone Update → Mid-Project Check-in → Completion → Feedback Request → Referral Request → Upsell/Other Services)
- Trigger: lifecycle_stage = 'Customer' (synced from HubSpot Closed Won)
- Referral Request Sequence live: triggered after positive feedback at Day 120+
- Quarterly customer touchpoint emails scheduled (ongoing)

**Subtasks:**

1. Build Customer Onboarding Journey — 8 emails at Day 0/3/30/60/90/120/130/180, triggered by `lifecycle_stage = 'Customer'` (3h) — Ref: Customer.io Guide §5, Journey 4
2. Build feedback → referral branch: if positive response to Day 120 email → trigger referral request at Day 130, if no referral → case study invitation at Day 190 (2h) — Ref: Customer.io Guide §5, Journey 5
3. Build upsell email (Day 180) — highlight other Digital Meld services the customer hasn't used, based on `services_interested` attribute (1h)
4. Set up quarterly customer touchpoint — ongoing check-in emails every 90 days after onboarding completes, sharing relevant content + new service announcements (1h)
5. Test full journey in Test workspace — verify timing, content, and branch logic (1h)
