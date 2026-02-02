---
id: task_20260130_FMHutn
title: 'Customer.io Deliverability: Domain Warm-Up &amp; List Hygiene Automation'
type: sales
status: todo
priority: medium
project: digital-meld
sprint: Sales-Funnel
created: '2026-01-30T10:15:27.846Z'
updated: '2026-01-30T10:15:27.846Z'
---

**Goal:** Execute the domain warm-up schedule and configure automated list hygiene to maintain deliverability.
**Owner:** Robert (monitoring) + Mark (content selection for warm-up sends)
**Effort:** M (6-8 hours, spread over 4-5 weeks)

**Acceptance Criteria:**

- Week 1-5 warm-up schedule executed (50/day → full volume)
- Bounce rate &lt;2%, spam complaints &lt;0.1%, unsubscribe &lt;0.5% throughout
- Hard bounce auto-suppression confirmed
- Soft bounce 3x/30 days → 60-day suppression rule active
- Sunset policy documented: 120 days no engagement → Dormant, 180 days → Win-back, 30 days after win-back → Suppress
- DMARC upgraded from p=none to p=quarantine after 30 days of clean monitoring

**Subtasks:**

1. Execute Week 1 warm-up: 50-100 emails/day to warm + highly engaged contacts only, send welcome emails + direct value content, monitor deliverability metrics daily (ongoing, 2h setup) — Ref: Customer.io Guide §7, Week 1
2. Execute Week 2-3 warm-up: ramp to 200-300, then 500-800/day, add newsletter segment + cold activation small cohort, monitor for spam spike (ongoing, check daily 30min) — Ref: Customer.io Guide §7, Weeks 2-3
3. Execute Week 4-5: ramp to 1,000-2,000/day, begin full newsletter cadence, expand cold activation to larger cohorts (ongoing, check daily 30min) — Ref: Customer.io Guide §7, Weeks 4-5
4. Configure list hygiene automation: hard bounce auto-suppress, soft bounce 3x → 60-day suppress, unsubscribe bidirectional sync (1h) — Ref: Customer.io Guide §7, List Hygiene Automation
5. Document sunset policy and build Win-back Journey (3 emails: 'Are we relevant?' → 'Last chance content' → 'Confirm or we stop') for dormant contacts (2h) — Ref: Customer.io Guide §5, Journey 3
6. After 30 clean days, upgrade DMARC from p=none to p=quarantine (then p=reject after another 30 days) (1h) — Ref: Customer.io Guide §2, DMARC progression
