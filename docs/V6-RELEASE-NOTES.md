# Veritas Kanban v6 Release Notes

Veritas Kanban 6.0.1 is the first supported stable v6 release. It makes agent
runtimes explicit, evidence-backed, and fail-closed, adds first-class Buzz
integration, and puts Grok Build, OpenAI Codex, Claude Code, and GitHub Copilot
CLI behind the same provider-neutral run, approval, credential, tool, worktree,
event, and completion contracts.

The 6.0.0 publication is retained as a quarantined prerelease after unresolved
desktop and workflow issues were found in the live backlog. Install 6.0.1 or
newer.

- Release tracker:
  [Stabilize Veritas Kanban 6.0.1 after quarantined 6.0.0](https://github.com/BradGroux/veritas-kanban/issues/924)
- Buzz epic:
  [First-class Buzz integration](https://github.com/BradGroux/veritas-kanban/issues/904)
- Harness epic:
  [Equal-footing agent harness support](https://github.com/BradGroux/veritas-kanban/issues/915)
- Detailed compatibility record: [Harness Compatibility](HARNESS-COMPATIBILITY.md)
- Versioned architecture:
  [v6 Agent Runtime Control Plane](architecture/V6-AGENT-RUNTIME-CONTROL-PLANE.md)
- Retained validation record: [v6 Release Candidate Evidence Packet](V6-RC-EVIDENCE-PACKET.md)
- Documentation freshness: 2026-07-24 for Veritas Kanban 6.0.1

## What Changed For Users

- Settings, `vk doctor --json`, API diagnostics, telemetry, and dispatch now
  use one `harness-support-profile/v1` state: Detected, Configured, Certified,
  Degraded, or Unsupported.
- Buzz can connect a pinned Nostr community to Squad Chat, import signed public
  persona and team definitions, run `buzz-agent` through generic ACP, expose a
  narrow run-scoped Veritas MCP bridge, and trigger allowlisted workflows from
  root messages.
- Grok Build, Buzz Agent, and GitHub Copilot CLI reuse the generic ACP v1 stdio
  adapter. Codex app-server uses its richer JSON-RPC v2 lifecycle adapter.
  Claude Code uses a supervised bare-mode stream-json adapter.
- Runs persist causal events, exact launch evidence, provider conversation
  identity, completion evidence, approval decisions, credential boundaries,
  and supervised ownership so reconnect and restart do not silently duplicate
  work.
- Provider versions, builds, capability digests, probe revisions, and fixtures
  invalidate stale certification instead of inheriting an old green state.
- Packaged SQLite startup now defers run-supervisor repository lookup until
  storage is initialized, and the desktop updater refuses older release
  metadata instead of offering a downgrade.

## Stabilization In 6.0.1

- Chat remains a reversible, bounded desktop panel with visible, Escape,
  browser Back, startup-state, and native menu recovery paths (#945).
- Task drawers, shared overlays, Archive cards, scoring profiles, and the
  template editor use intentional, reachable scroll and resize behavior
  (#935, #938, #939, #941).
- Workflow actions normalize omitted collections and show recoverable load
  failures instead of crashing task detail (#936).
- Full-page views, task detail, and nested Workflow overlays preserve their
  actual route origin, browser history, keyboard Back, and scroll position
  (#937).
- New scoring profiles open as visible, validated drafts from Profiles and
  Score Explorer (#943).
- Operations Digest distinguishes current task state from windowed events,
  reconciles board inventory and exclusions, bounds observed wall time, and
  exposes source IDs and metadata-quality findings (#944).
- Desktop setup is version-neutral and the bridge reports Electron's packaged
  application version instead of an absent npm environment value (#986).

## Tested Harness Baselines

| Harness                 | Tested version/build                                                           | Transport               | Source posture         | Release contract                                                           |
| ----------------------- | ------------------------------------------------------------------------------ | ----------------------- | ---------------------- | -------------------------------------------------------------------------- |
| Buzz Agent              | Buzz v0.4.24 at `710ed9fff57878a1d69f809b80a6ee0416c53fc4`; `buzz-agent 0.1.0` | ACP v1 stdio            | Open source            | Disabled by default; exact identity/capabilities required                  |
| Grok Build              | v0.2.111 build `94172f2aa4e5`                                                  | ACP v1 stdio            | Partial source lineage | Disabled by default; alpha self-report and provenance limit retained       |
| OpenAI Codex app-server | `codex-cli 0.145.0`, upstream `25af12f7e61572b0bc18ddb1008be543b91519b0`       | JSON-RPC v2 stdio       | Open source            | Exact generated schemas and disabled remote control required               |
| OpenAI Codex SDK        | `@openai/codex-sdk 0.144.3`                                                    | SDK event stream        | Published package      | Uses the shared launch, event, tool, credential, and completion contracts  |
| Claude Code             | `2.1.218 (Claude Code)`                                                        | supervised stream-json  | Partial source         | Bare mode, no permission bypass, exact stream fixtures                     |
| GitHub Copilot CLI      | v1.0.74 at public tag commit `2b809c84e87dbcc88f897cb4f3fb97c43b77af95`        | ACP v1 stdio            | Partial source         | Public preview; source/release provenance mismatch retained                |
| Hermes Agent            | v2026.7.7.2                                                                    | one-shot process        | Provider project       | Existing one-shot adapter; resume remains unsupported                      |
| OpenClaw                | v2026.6.11                                                                     | gateway tool invocation | Open source            | Existing adapter; operator must allow `sessions_spawn` and `sessions_send` |

The table states the reviewed baseline, not the current machine's live tier.
Only runtime evidence that matches the installed version, build, profile,
probe revision, capability digest, and passing deterministic fixtures can
report Certified. Credential-gated smoke is separate evidence and is recorded
in the release packet when available.

## Architecture

Every executable run follows the same authority chain:

1. Normalize the selected profile to `harness-support-profile/v1`.
2. Probe and persist `provider-runtime-manifest/v1`.
3. Render one immutable `task-envelope/v1` through the provider-owned
   transport.
4. Allocate a transactional `worktree-manifest/v1`.
5. Compile `run-launch-manifest/v1`, including sandbox, tools, MCP, approvals,
   environment key names, credential references, and budgets.
6. Supervise the local process or remote handle through `run-supervisor/v1`.
7. Persist redacted causal `run-event/v1` records before projecting legacy
   output.
8. Broker exact actions through `run-approval/v1` and one-shot credential
   leases through the system-owned `veritas-run` bridge.
9. Finish once through the idempotent `completion-result/v1` contract.

The generic ACP adapter and the inverse `vk acp serve --stdio` view reuse that
chain. Buzz relay delivery remains a communication adapter and never becomes a
task or completion authority.

## Breaking Changes And Migration Warnings

- Provider-less or adapter/profile-mismatched records no longer fall through to
  OpenClaw. Only known legacy Codex, Hermes, and Claude records with matching
  built-in type and command identity may infer an adapter during normalization.
- Claude Code no longer uses `--dangerously-skip-permissions`. Existing custom
  arguments that attempt to bypass permissions, inject configuration, inherit
  plugins, or select unrelated sessions are rejected.
- Unknown or changed provider builds lose certification. An enabled Degraded or
  Unsupported profile blocks dispatch until the operator fixes, disables, or
  replaces it.
- Credential-bound MCP servers are omitted from provider-native configuration.
  They run only through the one-shot Veritas bridge with an exact catalog,
  action, approval, and lease binding.
- Generic process stdin is not treated as a successful follow-up path.
  Conversation controls are available only when the persisted adapter evidence
  says the provider supports them.
- The public REST API remains `v1`; v6 adds contracts and endpoints without
  renaming the API mount. CLI, MCP, server, web, shared, and desktop package
  versions must all be 6.0.1.

Back up the current workspace before upgrading. Keep the complete v5.2.5
backup until v6 runtime verification is accepted. App rollback is safe only
when the older binary can open the current schema and profile records; otherwise
restore the pre-upgrade backup. See the
[v6 Upgrade, Install, Remote, And Admin Guide](V6-UPGRADE-INSTALL-ADMIN-GUIDE.md).

## Security Model

- Provider processes start without a shell in the exact assigned worktree.
- Environment values are allowlisted. Manifests, APIs, logs, telemetry,
  fixtures, screenshots, and issue evidence contain key names and opaque
  references, never secret values.
- Approval decisions bind to an exact action digest, reviewer, freshness
  requirement, expiry, attempt, and provider request. Drift, replay,
  cancellation, interruption, and duplicate terminal ownership fail closed.
- Tool calls bind to the immutable run catalog. Credential values resolve only
  inside a one-shot downstream MCP connection and credential-bearing results
  are rejected.
- Protocol frames, stdout, stderr, retained payloads, retries, and timeouts are
  bounded and redacted before durable storage.
- Required network rules block when runtime evidence cannot enforce them.
  Fine-grained method/path/domain proxy enforcement remains deferred to
  [run-scoped egress gateway](https://github.com/BradGroux/veritas-kanban/issues/855).

## Known Limitations

- Grok Build's released artifact is not fully traceable to the public source
  tree and self-reports alpha.
- GitHub Copilot CLI ACP is public preview. Its public tag, commit message, and
  runtime version do not provide complete binary-to-source provenance.
- Claude Code's complete CLI implementation is not public. Certification is
  bound to exact release behavior and checked-in stream fixtures.
- Buzz Agent sessions are in-memory and do not support ACP session load/resume.
  Buzz files, reactions, forums, DMs, and destructive edit/delete projection
  are not bridged.
- Hermes and OpenClaw do not gain unsupported interactive lifecycle controls.
- Linux and Windows desktop artifacts are unsigned preview evidence. Signed,
  notarized macOS arm64 remains the supported desktop distribution.
- A deterministic passing fixture does not prove provider authentication,
  subscription availability, quota, or live inference. Live smoke results are
  reported separately and never fabricated.

## Release Artifacts

The supported v6.0.1 publication set is:

- annotated source tag and GitHub release `v6.0.1`;
- signed and notarized `Veritas-Kanban-6.0.1-mac-arm64.dmg`;
- signed and notarized `Veritas-Kanban-6.0.1-mac-arm64.zip`;
- DMG and ZIP blockmaps;
- `latest-mac.yml`;
- SHA-256 sidecars; and
- Homebrew cask `bradgroux/tap/veritas-kanban`.

Final asset sizes, hashes, workflow URL, release URL, signed-runtime proof, and
Homebrew PR are written to the
[v6 Release Candidate Evidence Packet](V6-RC-EVIDENCE-PACKET.md) after
publication. Source preparation does not count as signed distribution proof.

## Deferred v6.x Work

- [Run-scoped egress gateway](https://github.com/BradGroux/veritas-kanban/issues/855)
  remains a v6.x enhancement for fine-grained outbound HTTP enforcement.
  v6.0.1 already blocks any required rule that the selected provider cannot
  prove it enforces.
