---
id: task_20260130_RGvLrG
title: Customer.io Service-Specific Drip Campaigns (3 Variants)
type: sales
status: todo
priority: medium
project: digital-meld
sprint: Sales-Funnel
created: '2026-01-30T10:15:27.769Z'
updated: '2026-01-30T10:15:27.769Z'
---

**Goal:** Build 3 service-specific drip campaigns in Customer.io for contacts who've shown interest in specific service areas.
**Owner:** Mark (copy/strategy) + Robert (build)
**Effort:** L (12-14 hours)

**Acceptance Criteria:**

- Microsoft Cloud Drip live: 6 emails / 21 days (Problem → Hidden ROI → Azure Case Study → Copilot Readiness → Client Testimonial → CTA)
- AI &amp; Automation Drip live: 6 emails / 21 days (Myth-Busting → Use Case Categories → AI Case Study → Implementation Framework → Podcast → Sprint CTA)
- Security &amp; Compliance Drip live: 6 emails / 21 days (Risk Awareness → Security Basics → Ransomware Case Study → CMMC/Compliance → Managed Security → CTA)
- Each drip targets correct segment and includes industry-specific Liquid variants

**Subtasks:**

1. Build Microsoft Cloud Drip — 6 emails targeting `'Microsoft Cloud' IN services_interested`, include Power Automate/BI quick wins, Azure cost case study, Copilot readiness content, multiple CTA options (assessment vs. call) (4h) — Ref: Customer.io Guide §4D, Campaign 1
2. Build AI &amp; Automation Drip — 6 emails targeting `'AI' IN services_interested`, lead with myth-busting tone, include 4 AI types that deliver ROI, predictive maintenance case study ($2.1M savings), AI Sprint offer (4h) — Ref: Customer.io Guide §4D, Campaign 2
3. Build Security &amp; Compliance Drip — 6 emails targeting `'Security' IN services_interested`, CMMC urgency for Construction contacts (Liquid variant), SOC/ISO for others, ransomware prevention case study, managed security CTA (4h) — Ref: Customer.io Guide §4D, Campaign 3
4. Test all 3 drips in Test workspace, verify segment targeting, Liquid logic, link tracking (2h)
