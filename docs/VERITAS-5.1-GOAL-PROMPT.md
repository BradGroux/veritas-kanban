# Veritas Kanban 5.1 Goal Prompt

```text
/goal Complete the Veritas Kanban 5.1 release train end to end.

Work from /Users/bradgroux/Projects/veritas-kanban. Start by refreshing live GitHub state, local git state, repo instructions, and release docs. Preserve unrelated local changes.

Current known queue as of 2026-06-18:
- PR #719: Dependabot production-dependencies group, green and clean.
- Issue #725: Docker source build is broken because .dockerignore excludes Dockerfile inputs.
- Issue #723: Sandbox policy presets for filesystem, network, environment, and credential access.
- Issue #722: Enforceable agent cost and tool-use budgets.
- Issue #720: Reusable agent profile packages with YAML/JSON import/export and launch.
- Issue #724: Multi-model decision review sessions with recorded outcomes.
- Issue #721: Shared live run sessions with view, co-drive, and fork permissions.

Recommended order:
1. Re-check and merge PR #719 first if still clean.
2. Fix #725 before feature work because Docker/self-host build is a release blocker.
3. Implement #723 next because sandbox policy is the security foundation.
4. Implement #722 next because budgets should flow through policy traces and run control.
5. Implement #720 next, using sandbox and budget posture in profile validation/launch.
6. Implement #724 next, reusing profiles, workflow primitives, budgets, telemetry, and work products.
7. Implement #721 last because live shared sessions touch multi-user, permissions, remote/mobile, WebSocket, artifacts, and active-run safety.

For each issue:
- Inspect existing schema, services, routes, UI, tests, docs, and nearby patterns before editing.
- Prefer small vertical slices and focused PRs. Combine only when the code is inseparable.
- Include tests and docs in the same PR that changes behavior.
- Close issues through merged PRs with clear "Fixes #..." references.
- If scope is larger than a sane PR, split into tracked sub-issues, but do not call the parent done until the user-facing capability and acceptance criteria are complete.

Docs must be current before release:
- README.md
- CHANGELOG.md
- docs/FEATURES.md
- docs/API-REFERENCE.md / API workflow docs where relevant
- CLI/MCP docs where commands or surfaces change
- security, policy, workflow, desktop, self-host, and release docs touched by the features
- v5 release notes/checklist docs should be updated or renamed/extended for 5.1 where appropriate

Release target:
- Use SemVer package metadata version 5.1.0.
- Use public release/tag naming v5.1.0, with prose allowed to say 5.1.
- Bump all workspace package versions together: root, shared, server, web, cli, mcp, desktop.
- Update README badge and docs/mcp version footer.
- Update pnpm lockfile consistently using the repo package manager only.

Required verification before final release:
- pnpm install --frozen-lockfile
- pnpm typecheck
- pnpm lint:budget
- pnpm build
- pnpm test:unit
- targeted API/UI/Playwright tests for touched surfaces
- pnpm desktop:smoke:mac:local
- pnpm desktop:package:mac:unsigned
- pnpm validate:release -- --version 5.1.0
- pnpm validate:release -- --version 5.1.0 --docker-build after #725

Release and distribution:
- Create and merge the final 5.1 release PR after all issue PRs are merged.
- Create/publish GitHub release v5.1.0.
- Run the Desktop Release workflow on main with channel=stable and verify signed/notarized macOS ZIP/DMG assets plus latest-mac.yml.
- Run pnpm validate:release -- --version 5.1.0 --github after tag/release publication.
- Update /Users/bradgroux/Projects/homebrew-tap/Casks/veritas-kanban.rb if the signed ZIP changed.
- Validate the tap from the tap checkout:
  HOMEBREW_NO_AUTO_UPDATE=1 brew style --cask bradgroux/tap/veritas-kanban
  brew audit --cask --strict --online bradgroux/tap/veritas-kanban
  brew install --cask --dry-run bradgroux/tap/veritas-kanban
  brew livecheck bradgroux/tap/veritas-kanban
- Create/merge the tap PR if needed.

Final answer must include:
- PRs/issues completed and merged
- Release/tag URL
- Desktop Release workflow run URL
- Homebrew tap PR/status
- Verification commands and results
- Any remaining risk or follow-up
```
