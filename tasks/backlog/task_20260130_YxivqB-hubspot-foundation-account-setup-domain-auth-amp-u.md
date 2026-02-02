---
id: task_20260130_YxivqB
title: 'HubSpot Foundation: Account Setup, Domain Auth &amp; User Config'
type: sales
status: todo
priority: high
project: digital-meld
sprint: Sales-Funnel
created: '2026-01-30T10:15:27.679Z'
updated: '2026-01-30T10:15:27.679Z'
---

**Goal:** Get HubSpot Sales Hub Pro fully configured so the team can log in and start working.
**Owner:** Robert (technical setup) + Brad (admin/permissions)
**Effort:** M (8-12 hours)

**Acceptance Criteria:**

- All 3 HubSpot seats active (Mark, Brad, Robert)
- Email domain authenticated (digitalmeld.io SPF/DKIM verified)
- Outlook + Calendar connected for all users
- Meeting links created (Mark: 30-min Discovery, Brad: 60-min Executive)
- HubSpot tracking code installed on digitalmeld.com

**Subtasks:**

1. Configure company settings — name, domain, timezone (America/Chicago), fiscal year, currency (2h) — Ref: HubSpot Guide §1, Step 1
2. Set up email domain authentication — add CNAME, SPF, DKIM DNS records for digitalmeld.io, verify domain (3h including DNS propagation) — Ref: HubSpot Guide §1, Step 2
3. Create user accounts with correct roles/permissions — Mark (Sales Manager), Brad (Admin), Robert (Sales Engineer) — Ref: HubSpot Guide §1, Step 3 (2h)
4. Connect Outlook email + Calendar for all 3 users, enable email logging + tracking + two-way calendar sync — Ref: HubSpot Guide §1, Steps 4-5 (2h)
5. Set up HubSpot Meeting links — Mark (30-min Discovery), Brad (60-min Executive Strategy), configure buffer times + availability (2h) — Ref: HubSpot Guide §1, Step 5
6. Install HubSpot tracking code on website + verify, set up Contact Us / Request Assessment forms — Ref: HubSpot Guide §1, Step 6 (2h)
