---
id: task_20260130_z6pAKK
title: Customer.io Welcome Series &amp; Cold Activation Campaign
type: sales
status: todo
priority: high
project: digital-meld
sprint: Sales-Funnel
created: '2026-01-30T10:15:27.761Z'
updated: '2026-01-30T10:15:27.761Z'
---

**Goal:** Launch the first two Customer.io campaigns — Welcome Series for new subscribers and Cold Activation for the cold database.
**Owner:** Mark (copy) + Robert (technical setup)
**Effort:** M (8-10 hours)

**Acceptance Criteria:**

- Welcome Series live: 4 emails over 10 days (Welcome + Who We Are → Industry Podcast Recommendation → Free Assessment Offer → Case Study + CTA)
- Cold Activation Campaign live: 6 emails over 30 days (Introduction → 'Start Small' Philosophy → Social Proof → Industry Trends → Free Resource → Opt-in Confirmation)
- Both use Liquid logic for industry-specific personalization (Construction, Energy, Professional Services, Industrial Ops)
- Cold Activation initially sending to small cohort (200 contacts) per warm-up schedule

**Subtasks:**

1. Build Welcome Series — 4 emails with full copy from guide, implement Liquid industry branching for Email 2 (podcast recommendation varies by industry), configure trigger: `newsletter_subscriber = true` OR `lifecycle_stage = 'Subscriber'` (3h) — Ref: Customer.io Guide §4A, Welcome Series (all 4 emails)
2. Build Cold Activation Campaign — 6 emails with Liquid industry variants for Construction/Energy/Professional Services, configure trigger: `temperature = 'Cold'` AND (`last_email_open &gt; 90 days` OR never opened) (3h) — Ref: Customer.io Guide §4B, Cold Activation (all 6 emails)
3. Build email templates in Customer.io template builder — consistent branding (Digital Meld blue, sans-serif, logo top-left), plain-text style for 1:1 emails from Mark (2h) — Ref: Customer.io Guide §6, Template 5 (Plain Text)
4. Test both campaigns in Test workspace — verify Liquid logic renders correctly for each industry, check all links, preview on mobile (2h)
5. Launch Welcome Series immediately, launch Cold Activation to first 200-contact cohort per warm-up schedule (1h) — Ref: Customer.io Guide §7, Domain Warm-Up Week 2
