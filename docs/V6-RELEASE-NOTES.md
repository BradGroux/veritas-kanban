# Veritas Kanban 6.1.0 Release Notes

Veritas Kanban 6.1.0 completes the agentic-control roadmap that followed the first stable v6 release. The release gives Buzz, Grok Build, OpenAI Codex, Claude Code, GitHub Copilot CLI, Hermes, and OpenClaw one provider-neutral control plane while retaining explicit transport and capability differences. It also adds governed knowledge collections, durable execution supervision, run-scoped network enforcement, safe workspace rewind, and resilient output handling.

> Veritas Kanban 6.0.0 remains a quarantined prerelease. Version 6.1.0 supersedes 6.0.2 as the supported stable v6 release after signed assets and updater metadata are published.

## Harness Support On Equal Footing

Every supported harness is now discovered, diagnosed, dispatched, observed, and completed through the same `harness-support-profile/v1`, `provider-runtime-manifest/v1`, immutable launch-manifest, approval, tool, credential, sandbox, phase-authority, and completion contracts. Settings, API diagnostics, telemetry, `vk doctor --json`, and dispatch consume the same redacted readiness evidence.

Equal footing does not claim identical native capabilities. Veritas probes the exact installed build and transport, persists capability evidence, and blocks unsupported lifecycle, tool, approval, sandbox, network, phase, or completion behavior before attempt creation. Provider upgrades invalidate prior conformance evidence until the new build passes its deterministic fixtures.

Buzz Agent and Grok Build use ACP transports with exact initialize and capability evidence. Codex CLI, SDK, and app-server retain their distinct supervised lifecycles. Claude Code uses a strict bare-mode stream, GitHub Copilot CLI remains bounded to its public-preview ACP contract, Hermes retains one-shot execution, and OpenClaw retains explicit gateway policy. Buzz relay communication remains independent from execution authority: Buzz transports signed messages while Veritas owns tasks, attempts, tools, approvals, and completion.

Repository-facing instructions are documented in [AGENTS.md](../AGENTS.md) and the reusable [agent template](AGENTS-TEMPLATE.md). Harness installation, authentication, capability limits, and remediation are documented in [Agent Providers](AGENT-PROVIDERS.md), with exact evidence in the [Harness Compatibility Matrix](HARNESS-COMPATIBILITY.md).

## Governed Execution And Recovery

Run-scoped egress enforcement resolves and pins allowed destinations, routes governed traffic through the gateway, applies protocol, host, port, HTTP method, and normalized path rules, and records redacted decision evidence. Required enforcement fails closed when a process can bypass or cannot prove the gateway.

Durable admission control now applies capacity, aggregate budgets, fairness, cancellation, queue leases, and circuit breaking to direct tasks, workflows, retries, fallbacks, continuations, provider handoffs, and child agents through one execution-tree contract. Agent-dependency health feeds load shedding so an unhealthy tree cannot continue amplifying provider, host, or workspace pressure.

Append-only admission snapshots now complete each serialized write before syncing, preventing short filesystem writes from truncating durable reservation evidence. Knowledge-collection routes also share the exact server permission prefix, keeping client discovery and server enforcement in fail-closed parity.

Durable goals survive turns, restarts, and provider continuations without inventing completion. Memory extraction is reviewed and attributable. Background commands and monitors are supervisor-owned, repetitive or stalled runs receive bounded recovery, and oversized output spills into governed artifacts instead of exhausting the active context.

## Knowledge Collections And Integrity

Workspace knowledge collections support classified immutable sources, cited and versioned derived pages, reviewed ingestion dry runs, atomic apply and reversal, scoped keyword and QMD search, query promotion, and cited work-product export. File and SQLite backends preserve the same workspace, digest, attribution, idempotency, contradiction, graph, activity, and redaction contracts.

Deterministic integrity linting finds structural graph errors, invalid schemas and metadata, provenance gaps, source-hash drift, invalid citation locations, freshness violations, orphan pages, missing canonical terms, unanswered research questions, contradictions, near-duplicates, supersession candidates, and evidence gaps. Material claims have attributable, evidence-linked, reversible lifecycle controls, so disputed or superseded statements remain visible and reviewable rather than being silently overwritten.

## Workspace Checkpoints And Rewind

Turn-boundary checkpoints capture run-owned Git, index, file, exclusion, ownership, conversation, and attributable provider-diff state. Rewind is preview-first, digest-bound, conflict-aware, and limited to explicit selected paths. The control route can quiesce an exact active Codex app-server turn and fork an earlier approved turn into a new provider thread.

Ambiguous attribution, unsupported providers, stale runtime evidence, external edits, and unresolved ownership conflicts fail closed. Failed storage transactions preserve descendant state and do not mutate paths outside the approved preview.

## Install Or Upgrade

Install or upgrade with Homebrew:

```bash
brew update
brew upgrade --cask bradgroux/tap/veritas-kanban
```

For a first installation:

```bash
brew install --cask bradgroux/tap/veritas-kanban
```

Manual installation uses the signed and notarized macOS arm64 DMG or ZIP from the [v6.1.0 release](https://github.com/BradGroux/veritas-kanban/releases/tag/v6.1.0). Back up the complete stopped-writer workspace before upgrading and keep the backup until the new runtime is accepted.

## Breaking Changes And Migration Warnings

Veritas Kanban 6.1.0 advances SQLite through migrations 30 to 33 for knowledge collections and integrity operations. Rollback to an older schema requires restoring the stopped-writer pre-upgrade backup; do not open migrated data with an older binary.

The public REST API remains mounted at `v1`. Provider-less or adapter/profile-mismatched records do not fall through to OpenClaw. Unknown or changed provider builds lose certification until current probes and deterministic fixtures pass. Claude Code does not launch with `--dangerously-skip-permissions`. Credential-bound MCP servers remain available only through the mediated run-scoped bridge.

## Known Limitations

Buzz Agent sessions remain in-memory and do not support session load/resume. Buzz files, reactions, forums, direct messages, and destructive edit/delete projection are not bridged. GitHub Copilot CLI ACP remains public preview. Grok Build's stable artifact still self-reports alpha and cannot be fully traced to the current public source tree. Claude Code's complete CLI implementation is not public, so certification is bound to exact release behavior and checked-in fixtures.

Deterministic compatibility does not prove provider authentication, subscription availability, quota, or live inference. Linux and Windows desktop artifacts remain unsigned previews; signed and notarized macOS arm64 is the supported stable desktop distribution.

## Release Artifacts

The supported stable desktop release publishes signed and notarized `Veritas-Kanban-6.1.0-mac-arm64.dmg` and `Veritas-Kanban-6.1.0-mac-arm64.zip`, blockmaps, SHA-256 sidecars, and `latest-mac.yml` updater metadata from the annotated `v6.1.0` tag. Publication is complete only after GitHub assets, signature, Gatekeeper, stapling, updater, downloaded-app launch, and Homebrew installation have been verified.

## Documentation And Evidence

- [Agent guide and reusable template](AGENTS-TEMPLATE.md)
- [Agent provider setup and operations](AGENT-PROVIDERS.md)
- [Harness compatibility matrix](HARNESS-COMPATIBILITY.md)
- [Buzz integration guide](BUZZ-INTEGRATION.md)
- [v6 runtime architecture](architecture/V6-AGENT-RUNTIME-CONTROL-PLANE.md)
- [v6 compatibility and release policy](V6-COMPATIBILITY-AND-RELEASE-POLICY.md)
- [v6 upgrade and administration guide](V6-UPGRADE-INSTALL-ADMIN-GUIDE.md)
- [Changelog](../CHANGELOG.md)
