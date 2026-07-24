# Veritas Kanban v6 GA Checklist

This checklist is the stable-release gate for Veritas Kanban 6.0.0. Command
results, platform details, workflow links, limitations, and artifact hashes
belong in [v6 Release Candidate Evidence Packet](V6-RC-EVIDENCE-PACKET.md).

Documentation freshness: 2026-07-24 for Veritas Kanban 6.0.0.

## Source And Scope

- [x] The Buzz integration epic and every required child are closed through
      merged, focused pull requests.
- [x] The equal-footing harness epic and every required child are closed
      through merged, focused pull requests.
- [ ] The release tracker lists the exact main baseline, release branch, release
      PR, deferred v6.x work, and no unresolved release blocker.
- [x] Root, shared, server, web, CLI, MCP, and desktop manifests are 6.0.0.
- [x] `AGENTS.md`, README badge, health, CLI, MCP, desktop bundle, artifact
      names, updater metadata, changelog, and current docs agree on 6.0.0.
- [x] The public API remains intentionally `v1`, with additive v6 contracts and
      tested CLI/MCP compatibility.

## Provider Certification

- [x] Buzz Agent v0.4.24 / `buzz-agent 0.1.0` passes the composed
      credential-free compatibility gate at the pinned commit and fixture
      revision.
- [x] Grok Build v0.2.111 build `94172f2aa4e5` passes exact-version ACP,
      restrictive-policy, source-limitation, and deterministic fixtures.
- [x] Codex app-server 0.145.0 passes exact generated schemas, disabled remote
      control, lifecycle, approval, event, completion, and deterministic
      fixtures.
- [x] Codex CLI and `@openai/codex-sdk 0.144.3` pass their provider-runtime,
      launch, tool, event, credential, and completion gates.
- [x] Claude Code 2.1.218 passes bare-mode launch, permission, environment,
      stream, lifecycle, MCP, event, completion, and deterministic fixtures.
- [x] GitHub Copilot CLI 1.0.74 passes exact ACP handshake, restrictive launch,
      preview/source-limit, and deterministic fixtures.
- [x] Hermes v2026.7.7.2 and OpenClaw v2026.6.11 retain truthful existing
      support and explicit unsupported controls.
- [x] Settings, API, `vk doctor --json`, dispatch, and telemetry report the same
      Detected, Configured, Certified, Degraded, or Unsupported state.
- [x] Every Certified claim has exact runtime/build and passing deterministic
      evidence. Credential-gated smoke is recorded separately; unavailable
      credentials, quota, subscriptions, binaries, and upstream services are
      reported rather than inferred.

## Security, Migration, And Data Preservation

- [x] Legacy provider profiles normalize only through exact built-in
      type/command identity and never fall through to OpenClaw.
- [x] Claude Code permission bypass is absent and unsafe custom launch controls
      fail closed.
- [x] Approval decisions bind to exact action, attempt, reviewer, expiry, and
      authentication freshness; replay and drift tests pass.
- [x] Credential definitions, leases, run catalogs, the `veritas-run` bridge,
      logs, telemetry, fixtures, and APIs remain value-free outside the
      one-shot downstream call.
- [x] Provider protocol frames, stdout/stderr, events, retries, timeouts, and
      retained payloads are bounded and redacted.
- [x] Required unsupported sandbox, network, tool, MCP, credential, lifecycle,
      and provider controls block before attempt mutation.
- [x] A populated v5.2.5 desktop workspace upgrades through an isolated copy
      with matching representative counts, `PRAGMA quick_check=ok`, preserved
      owner/profile metadata, preserved registry absence, and a working v6
      runtime. A separate exact-format v5.2.5 registry fixture verifies populated
      registry compatibility.
- [x] File-backed migration and restore paths pass their seven-test portability
      fixture.
- [x] Rollback guidance has been tested against the actual schema/profile
      posture and does not promise destructive down migration.
- [x] Secret and tracked-runtime-security scans pass.

## Application And Runtime

- [x] A clean dependency install and build produce new shared, server, web, CLI,
      MCP, and desktop outputs without reused `dist`, staged desktop payloads,
      or prior release artifacts.
- [x] An isolated in-app Browser run verifies first-run, login, provider and Buzz
      Settings, degraded states, themes, command-palette focus, and a clean
      console. Deterministic and E2E suites verify task launch, causal events,
      approvals, cancellation, completion, MCP, worktrees, telemetry, and Buzz
      mapping/replay under the maintainer-approved release-evidence split
      recorded in the evidence packet.
- [x] Dark/light themes, keyboard flow, labels, and focus are inspected in the
      in-app Browser; compact layout and recoverable error states pass the E2E
      matrix under the same evidence split.
- [x] A fresh native macOS build verifies one instance, visible window, bundled
      server/web health, menus, shortcuts, window restoration, update check,
      clean close, reopen, and quit.
- [x] The unsigned DMG/ZIP is inspected and the packaged app launches from the
      packaged artifact with an isolated profile.

## Mantine component-system cleanup gate

- [x] Run `pnpm --filter @veritas-kanban/web build` before the bundle check.
- [x] Run `pnpm qa:mantine`.
- [x] Run `pnpm test:e2e -- e2e/mantine-qa-gate.spec.ts`.
- [x] Retain visual and accessibility evidence for current routes, dark/light
      themes, compact widths, keyboard navigation, focus, labels, and touch
      targets.
- [x] Track planned but unavailable surfaces as temporary holdouts instead of
      claiming coverage.
- [x] No active feature imports legacy primitive compatibility wrappers outside
      documented internals.
- [x] No direct shadcn/Radix dependency or vendor-radix bundle returns.
- [x] Bundle sizes remain within the recorded QA budgets or have an explicit
      release-risk acceptance.

## Final Release Validation Commands

Run from the clean release-candidate worktree:

```bash
node --version
pnpm --version
git --version
pnpm install --frozen-lockfile
pnpm check:pnpm-settings
pnpm audit --prod --audit-level=high
pnpm lint
pnpm lint:budget
pnpm qa:mantine
pnpm typecheck
pnpm build
pnpm test:unit
pnpm test:e2e
pnpm smoke:cli-mcp
pnpm test:buzz:compatibility
pnpm desktop:test
pnpm desktop:build
pnpm desktop:check:electron-artifacts
pnpm desktop:smoke:mac:local
pnpm desktop:package:mac:unsigned
pnpm validate:release -- --version 6.0.0
pnpm validate:release -- --version 6.0.0 --docker-build
```

Provider-specific deterministic suites are part of `pnpm test:unit`; record
their test counts and exact fixture baselines separately. Run credential-gated
provider smoke only when the exact binary, authentication, subscription, and
quota are available.

## Distribution And Post-Publication

- [ ] The ready release PR passes required CI and the `ci:full` workspace suite,
      receives focused standards/spec review, and merges to main.
- [ ] Annotated tag `v6.0.0` peels to the exact release merge commit.
- [ ] The GitHub release is published from reviewed v6 release notes.
- [ ] Desktop Release completes with signed/notarized arm64 DMG and ZIP,
      blockmaps, `latest-mac.yml`, and SHA-256 sidecars.
- [ ] Independent downloads match GitHub digests, sidecars, updater metadata,
      byte sizes, and SHA-256 values.
- [ ] DMG and ZIP app signatures, hardened runtime, Gatekeeper, and notarization
      stapling pass.
- [ ] The downloaded signed app launches with an isolated profile, reports
      6.0.0, verifies provider support, checks updates, executes a bounded task,
      and quits cleanly.
- [ ] `pnpm validate:release -- --version 6.0.0 --github --repo BradGroux/veritas-kanban`
      passes.
- [ ] The Homebrew cask PR uses the published ZIP checksum, merges, and the
      registered tap passes style, strict online audit, dry-run install, and
      livecheck.
- [ ] The evidence packet contains release/workflow/asset/Homebrew links,
      exact hashes, runtime results, limitations, and deferred v6.x issues.
- [ ] The release tracker closes only after every distribution surface above is
      independently verified.
