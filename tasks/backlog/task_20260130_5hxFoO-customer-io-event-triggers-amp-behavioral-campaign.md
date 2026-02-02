---
id: task_20260130_5hxFoO
title: Customer.io Event Triggers &amp; Behavioral Campaigns
type: sales
status: todo
priority: medium
project: digital-meld
sprint: Sales-Funnel
created: '2026-01-30T10:15:27.791Z'
updated: '2026-01-30T10:15:27.791Z'
---

**Goal:** Set up real-time event-triggered campaigns in Customer.io that respond to high-intent website behavior.
**Owner:** Robert (event tracking implementation) + Mark (email copy)
**Effort:** M (8-10 hours)

**Acceptance Criteria:**

- Website event tracking live (Customer.io JavaScript snippet installed)
- Trigger 1: Assessment page visit → immediate assessment offer email (within 5 min)
- Trigger 2: Pricing page visit → sales alert to Mark + follow-up email (2h delay)
- Trigger 3: Podcast episode played → related content email (1 day delay)
- Trigger 4: Email engagement spike (3+ opens in 7 days) → sales alert for personal outreach
- All triggers respect suppression segment (in_sales_sequence = true)

**Subtasks:**

1. Install Customer.io JavaScript snippet on digitalmeld.com, configure page_viewed auto-tracking, test events firing in Test workspace (3h) — Ref: Customer.io Guide §3, Event Tracking - Option 1 JavaScript
2. Build Trigger 1: Assessment Page Visit → immediate email with assessment type branching (Copilot Readiness vs Cloud Security), 5-minute delay (2h) — Ref: Customer.io Guide §4F, Trigger 3
3. Build Trigger 2: Pricing Page Visit → sales alert (Slack/email to Mark with contact details + recommended action) + 2-hour delayed follow-up email (2h) — Ref: Customer.io Guide §4F, Trigger 4
4. Build Trigger 3: Podcast Episode Played → 1-day delayed email with Liquid topic branching (AI, Cloud Migration, Security content bundles) (2h) — Ref: Customer.io Guide §4F, Trigger 2
5. Build Trigger 4: Engagement Spike Alert — contact opens 3+ emails in 7 days → alert Mark with engagement details + suggested personal outreach message (1h) — Ref: Customer.io Guide §4F, Trigger 5
