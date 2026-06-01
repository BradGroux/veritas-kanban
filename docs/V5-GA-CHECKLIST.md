# Veritas Kanban v5 GA Checklist

This checklist tracks the release evidence that must be true before v5.0 GA.
The GitHub epic remains the source of scheduling truth; this document is the
operator checklist for final release verification.

## Required Release Gates

- [ ] Fresh install verifies the desktop app can start the bundled server, load
      the renderer, and create or open a board.
- [ ] Upgrade verifies a v4 file-backed project can migrate to SQLite and can
      recover through the rollback drill.
- [ ] Backup and restore verifies SQLite data, task files, settings, templates,
      attachments, workflow state, and audit history.
- [ ] Multi-user mode verifies workspace switching, memberships, invitations,
      scoped API tokens, actor attribution, and RBAC denial paths.
- [ ] Remote mode verifies pairing, trusted host validation, token/session
      lifecycle, WebSocket sync, and local-only secret handling.
- [ ] Security review covers desktop bridge calls, auth/session handling,
      scoped tokens, remote access, workflow execution, and agent tool gates.
- [ ] Performance/load review covers SQLite read/write paths, dashboard queries,
      WebSocket fan-out, workflow run updates, and remote/mobile clients.
- [ ] Docs cover upgrade, desktop install, remote access, admin operations,
      backup/restore, diagnostics, and known platform limits.

## Mantine component-system cleanup gate

Run this gate before closing #418, #417, or the v5 release checklist issue.

- [ ] Run `pnpm --filter @veritas-kanban/web build` before the bundle check.
- [ ] Run `pnpm qa:mantine` and keep the output in the PR verification notes.
- [ ] Run `pnpm test:e2e -- e2e/mantine-qa-gate.spec.ts` and keep the generated
      visual and accessibility evidence attached to the Playwright run.
- [ ] Confirm visual smoke screenshots cover desktop dark mode, desktop light
      mode, and mobile dark mode for every current v5 GA route.
- [ ] Confirm keyboard navigation, focus traps, screen-reader names, reduced
      horizontal overflow, and mobile touch-target checks pass for board, task
      detail, create task, settings, command/search, and auth/setup flows.
- [ ] Confirm current route coverage includes board, activity, backlog, archive,
      templates, workflows, drift, decisions, scoring, policies, dashboard
      surfaces on the board, and the migrated overlays.
- [ ] Track planned-but-not-yet-present surfaces as temporary holdouts instead
      of marking them covered. Current holdouts: unified work products,
      maintenance center, workflow visual builder, and final run replay view.
- [ ] Confirm no v5 GA-blocking route imports the old primitive compatibility
      wrappers except explicitly retained custom surfaces and wrapper internals.
- [ ] Confirm no `shadcn` package, direct `@radix-ui/react-*` package, or
      `vendor-radix` bundle chunk is present.
- [ ] Confirm bundle budgets remain within the `pnpm qa:mantine` thresholds or
      record an explicit release-risk acceptance.

## Final Sign-Off Notes

Each GA release candidate should link the PRs or workflow runs that satisfy the
gates above. If a gate is intentionally deferred, link the follow-up issue and
state the user-visible risk in release notes.
