---
id: task_example_004
title: Set up CI/CD pipeline with GitHub Actions
type: automation
status: todo
priority: medium
project: my-project
created: '2026-01-16T11:00:00.000Z'
updated: '2026-01-16T11:00:00.000Z'
subtasks:
  - id: sub_004a
    title: Create lint + typecheck workflow
    done: false
  - id: sub_004b
    title: Add unit test runner
    done: false
  - id: sub_004c
    title: Configure build verification
    done: false
  - id: sub_004d
    title: Set up staging auto-deploy
    done: false
  - id: sub_004e
    title: Add production deploy with manual approval
    done: false
position: 3
---

Create a complete CI/CD pipeline using GitHub Actions with staged deployments.

**Pipeline Stages:**

1. **Lint & Typecheck** — Run ESLint + TypeScript compiler on every push
2. **Test** — Run unit and integration tests
3. **Build** — Verify production build succeeds
4. **Deploy Staging** — Auto-deploy to staging on `main` branch push
5. **Deploy Production** — Manual approval gate, then deploy

**Requirements:**

- Use pnpm for package management
- Cache node_modules between runs
- Run stages in parallel where possible
- Slack notification on failure
- Branch protection: require CI pass before merge
