---
id: task_20260130_qOORsG
title: 'Customer.io Foundation: Account Setup, Domain Verification &amp; DNS'
type: sales
status: todo
priority: high
project: digital-meld
sprint: Sales-Funnel
created: '2026-01-30T10:15:27.727Z'
updated: '2026-01-30T10:15:27.727Z'
---

**Goal:** Customer.io Startup account fully configured with authenticated sending domain and proper DNS records.
**Owner:** Robert (DNS/technical) + Brad (account admin)
**Effort:** M (6-8 hours)

**Acceptance Criteria:**

- Customer.io Startup account active with Production + Test workspaces
- Sending domain `mail.digitalmeld.io` configured
- SPF, DKIM (2 CNAME records), DMARC, and custom tracking domain DNS records live and verified
- DMARC starts at p=none (monitoring mode)
- User permissions set (Brad: Admin, Mark: Admin, Robert: Team Member)

**Subtasks:**

1. Activate Customer.io Startup account (free tier starting Feb 10), create Production workspace ('Digital Meld Production') + Test workspace, set timezone to US Central (2h) — Ref: Customer.io Guide §2, Workspace Configuration
2. Add sending domain `mail.digitalmeld.io`, get DKIM CNAME values from Customer.io (1h) — Ref: Customer.io Guide §2, Sending Domain Setup
3. Configure all DNS records — SPF TXT record (merge with existing), 2x DKIM CNAME records, DMARC TXT record (p=none), custom tracking domain CNAME (2h) — Ref: Customer.io Guide §2, DNS Records
4. Verify all DNS records via Customer.io verification tool + mxtoolbox.com, troubleshoot any propagation issues (1h) — Ref: Customer.io Guide §2, Step 3
5. Set up user permissions — Brad + Mark as Admin, content/sales as restricted roles (1h) — Ref: Customer.io Guide §2, User Permissions
6. Document warm-up schedule: Week 1 (50-100/day), Week 2 (200-300), Week 3 (500-800), Week 4 (1,000-2,000) — Ref: Customer.io Guide §7, Domain Warm-Up
