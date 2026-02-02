---
id: task_20260130_9byuWO
title: 'HubSpot Workflow Automation: Lead Scoring, Lifecycle &amp; Assignment'
type: sales
status: todo
priority: high
project: digital-meld
sprint: Sales-Funnel
created: '2026-01-30T10:15:27.777Z'
updated: '2026-01-30T10:15:27.777Z'
---

**Goal:** Build the core HubSpot workflows that automate lead routing, scoring, lifecycle advancement, and stale deal alerts.
**Owner:** Brad (workflow design) + Robert (testing)
**Effort:** L (12-16 hours)

**Acceptance Criteria:**

- Workflow 1: New Contact Round-Robin (Mark ↔ Brandy) with auto-task creation
- Workflow 2: Lead Scoring — engagement points (email open +5, click +10, form +20, meeting +50) + ICP fit points (revenue +20, no CTO +15, growth +10) + decay (no activity 30d = -10)
- Workflow 3: Lifecycle Stage Auto-Advancement (Subscriber→Lead→MQL→SQL→Opportunity→Customer)
- Workflow 4: Stale Deal Reminders (Stage 1: 7 days, Stage 2-3: 14 days, Stage 4-5: 7 days)
- Workflow 5: Re-Engagement Trigger (30/60/90 day dormancy auto-emails)

**Subtasks:**

1. Build Workflow 1: New Contact Round-Robin — trigger on contact create, rotate between Mark + Brandy, set Lead Status = 'Open', create follow-up task, send internal notification (2h) — Ref: HubSpot Guide §7, Workflow 1
2. Build Workflow 2: Lead Scoring — positive triggers (email engagement, website visits, form fills, ICP criteria) + negative triggers (inactivity decay, unsubscribe) + alert threshold (score ≥80 = hot lead notification) (3h) — Ref: HubSpot Guide §7, Workflow 2
3. Build Workflow 3: Lifecycle Stage Advancement — Subscriber→Lead (content download/reply), Lead→MQL (score ≥50 + ICP fit), SQL→Opportunity (deal created), Opportunity→Customer (deal won) (3h) — Ref: HubSpot Guide §7, Workflow 3
4. Build Workflow 4: Stale Deal Reminders — daily check, branch by stage, create tasks + notifications for deal owners when activity gaps exceed thresholds (2h) — Ref: HubSpot Guide §7, Workflow 4
5. Build Workflow 5: Re-Engagement 30/60/90 — auto-send check-in at 30 days, value-add content at 60, move to Bad Timing + nurture at 90 (2h) — Ref: HubSpot Guide §7, Workflow 5
6. Build Workflows 6-8: Won Deal → Onboarding (welcome email + delivery team task + Teams notification), Lost Deal → Nurture (thank you + 180-day re-engagement), Meeting Booked → Prep Tasks (research task + pre-call questionnaire + deal creation) (4h) — Ref: HubSpot Guide §7, Workflows 6-8
