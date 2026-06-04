# Codebase Audit - 2026-05-16

This audit covered the server, web app, shared package, CLI, MCP server, docs, scripts, and CI.

## Changes Applied

- Fixed Tool Policies API calls to use the shared `apiFetch` helper, so sub-path deployments and custom `VITE_API_URL` values work consistently.
- Fixed same-column kanban drag reorder state so reorder persistence can fire.
- Fixed checkpoint clearing when tasks are marked `done` or explicitly cleared.
- Fixed dependency blocking so `blocked -> in-progress` cannot bypass incomplete blockers.
- Hardened outbound webhook delivery through shared URL validation, DNS checks, and manual redirect handling.
- Added `VK_API_KEY` headers to raw CLI summary and memory fetch paths.
- Improved CLI/MCP API error messages for standard `{ success: false, error }` envelopes.
- Included CLI and MCP packages in the root build and CI build-output checks.
- Added a release validator for package version alignment, changelog/badge checks, local artifacts, git tags, and GitHub release state.
- Added scheduled Playwright and k6 CI gates outside the fast PR workflow.
- Fixed Docker dependency stages to copy CLI and MCP package manifests now that they are part of the workspace.
- Split task detail, create-task, settings, search, and chat panels out of the initial web bundle through lazy loading.
- Centralized web view metadata for URL routing, header navigation, command palette navigation, and lazy-route loading labels.
- Centralized task-detail tab metadata and reset behavior so feature-gated or disabled tabs cannot strand the panel on hidden content.
- Removed the warning cluster in `server/src/index.ts` and added a CI lint warning budget to prevent new debt.
- Fixed stale CLI/MCP runtime versions by reading package metadata.
- Fixed `vk setup` sample-task guidance so it no longer prints an impossible task ID.
- Corrected stale health endpoint and port docs.
- Quarantined the legacy review-task creation script behind an explicit opt-in flag.

## Verified Findings

- Production dependency audit is clean.
- `pnpm typecheck` passes across the workspace.
- `pnpm test:unit` passes across server and web packages.
- Targeted regressions pass for URL validation, squad webhooks, task checkpoint/dependency behavior, auth, feedback, and web API helpers.
- `pnpm build` passes across shared, server, web, CLI, and MCP after expanding the root build.
- `pnpm lint` exits 0 and currently reports 601 warnings, down from 728, mostly `any`, non-null assertions, and test-only unused values.
- `pnpm lint:budget` enforces the current warning ceiling and prints package/rule counts so future cleanup can ratchet it down.
- `pnpm validate:release -- --github` passes for v4.3.1, including local tag, origin tag, and published GitHub release checks.
- Scheduled QA workflow YAML parses successfully.
- The Vite production build no longer emits oversized chunk warnings; the largest app chunk is the lazy `TaskDetailPanel` chunk at 473.98 kB.
- Source TODO sweep found two intentional future seams: OpenClaw `sessions_spawn` workflow execution and CSP style nonce migration.

## Refactor Targets

- Centralize all outbound integrations into a named endpoint registry with validation, secrets, delivery history, and audit events.
- Add workflow agent execution profiles for read-only review, workspace-write implementation, local-only no-network, and publish-capable networked runs.
- Replace the remaining OpenClaw workflow execution placeholder with the same provider-adapter model used by the Codex agent path.
- Move production style handling away from broad CSP `unsafe-inline` once the UI/runtime path supports nonce-tagged style injection consistently.
- Move more services behind the existing storage provider abstraction instead of direct file I/O.
- Centralize web view registration so `App`, `Header`, and command palette navigation cannot drift.
- Extract task-detail tab registration so feature-gated tabs cannot strand users on hidden content.
- Tighten lint in phases: app code first, test files second.

## Expansion Candidates

- Work Queue view focused on next actions, blockers, agent status, and review readiness.
- Saved board views backed by the existing URL filter model.
- Review readiness summary in task details using verification, deliverables, review, metrics, and observations.
- Outbound integration registry for hooks, policies, squad chat, and failure alerts.
- Release validation script covering versions, changelog, tag, GitHub release, Docker build, CLI, and MCP artifacts.
- Scheduled Playwright and k6 CI jobs separate from the fast PR gate.

## Tracker Follow-Up

- [#394](https://github.com/BradGroux/veritas-kanban/issues/394) - Centralize outbound integration endpoint registry and delivery audit.
- [#395](https://github.com/BradGroux/veritas-kanban/issues/395) - Complete OpenClaw workflow-step execution through provider adapters.
- [#396](https://github.com/BradGroux/veritas-kanban/issues/396) - Remove broad CSP unsafe-inline style allowance in production.
- [#397](https://github.com/BradGroux/veritas-kanban/issues/397) - Centralize web view, navigation, and task-detail tab registration.
- [#398](https://github.com/BradGroux/veritas-kanban/issues/398) - Reduce lint warning debt and phase in stricter lint gates.
- [#399](https://github.com/BradGroux/veritas-kanban/issues/399) - Add release validation script for versions, artifacts, tags, and GitHub releases.
- [#400](https://github.com/BradGroux/veritas-kanban/issues/400) - Add scheduled Playwright and k6 CI gates outside the fast PR path.
- [#401](https://github.com/BradGroux/veritas-kanban/issues/401) - Add saved board views backed by URL filters.
- [#402](https://github.com/BradGroux/veritas-kanban/issues/402) - Split oversized frontend bundles and route-heavy Vite chunks.
