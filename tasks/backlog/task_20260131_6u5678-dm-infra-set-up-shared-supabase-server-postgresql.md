---
id: task_20260131_6u5678
title: 'DM Infra: Set up shared Supabase server (PostgreSQL)'
type: code
status: todo
priority: medium
created: '2026-01-31T02:20:28.419Z'
updated: '2026-01-31T16:13:54.621Z'
---

Set up a self-hosted Supabase instance on Azure as the shared Digital Meld database platform. This is the central PostgreSQL server for ALL DM applications except Ghost (which requires MySQL).

Supabase provides: PostgreSQL database, REST API (PostgREST), real-time subscriptions, auth, storage, and a dashboard (Supabase Studio).

Use cases:

- Rubicon backend
- Future APIs and applications
- CRM / lead tracking data
- Analytics and metrics
- Any new DM product or service

Deployment options:

1. Self-hosted on Azure Container Apps or App Service (Docker Compose)
2. Azure Database for PostgreSQL + self-hosted Supabase services
3. Supabase Cloud (free tier to start, paid later) — simplest but less control

Recommendation: Self-host on Azure using Founders Hub credits. Supabase provides official Docker Compose for self-hosting. Run on an Azure VM (B2s) or Container Apps.

Docs: https://supabase.com/docs/guides/self-hosting/docker

This is separate from the Ghost/website infrastructure. Ghost uses its own dedicated MySQL instance.
