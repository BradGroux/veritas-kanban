---
id: task_20260131_WvxZ1w
title: 'DM-Web Azure: Provision MySQL Flexible Server'
type: code
status: todo
priority: medium
created: '2026-01-31T02:14:16.247Z'
updated: '2026-01-31T16:13:54.527Z'
---

Provision MySQL Flexible Server (Burstable B1ms) for Ghost CMS ONLY. Two databases: ghost_prod, ghost_dev.

Why MySQL instead of Supabase/PostgreSQL: Ghost does not support PostgreSQL. MySQL is hardcoded into Ghost core — they use MySQL-specific queries throughout the codebase (Knex.js with MySQL dialect). The Ghost team has explicitly stated they have no plans to add Postgres support. Community attempts to run Ghost on Postgres break on every update.

This is a small, lightweight instance dedicated solely to Ghost. All other DM applications (Rubicon, APIs, CRM, analytics) should use the shared Supabase/PostgreSQL platform (separate task).
