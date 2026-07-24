# Veritas Kanban v6 Upgrade, Install, Remote, And Admin Guide

This is the release-facing operator guide for Veritas Kanban 6.0.0. The
detailed provider commands live in [Agent Providers](AGENT-PROVIDERS.md), the
machine-readable support contract is summarized in
[Harness Compatibility](HARNESS-COMPATIBILITY.md), and Buzz relay setup lives
in [Buzz Integration](BUZZ-INTEGRATION.md).

Documentation freshness: 2026-07-24 for Veritas Kanban 6.0.0.

## Fresh Mac Desktop Install

Install the signed/notarized stable app:

```bash
brew tap BradGroux/tap
brew install --cask veritas-kanban
```

Manual installation uses
`Veritas-Kanban-6.0.0-mac-arm64.zip` from the
[v6.0.0 GitHub release](https://github.com/BradGroux/veritas-kanban/releases/tag/v6.0.0).
Move `Veritas Kanban.app` into `/Applications`, launch it normally, and verify
Settings -> Maintenance before enabling an agent or external integration.

For a new board:

1. Choose Board Only unless agent execution is required immediately.
2. Create the local admin password and retain the recovery key securely.
3. Confirm `/api/health` reports version 6.0.0.
4. Create a governed backup before adding external credentials or relay
   mappings.

The default desktop workspace remains:

```text
~/Library/Application Support/@veritas-kanban/desktop/profiles/default/workspaces/local/
```

Keep the authoritative SQLite database on the normal local Application Support
filesystem. NAS, SMB, NFS, FUSE, iCloud, Dropbox, OneDrive, and other
synchronized/remote filesystems are unsupported database locations.

## v5 To v6 Upgrade

The supported source is the latest signed v5.2.5 desktop release or an
equivalent v5.2.5 self-hosted workspace.

1. In v5.2.5, create a governed export/backup in Settings -> Maintenance and
   confirm the report completed.
2. Record representative counts for tasks, Squad Chat messages, telemetry,
   workflow definitions/runs, provider profiles, and agent registry entries.
3. Pause any heartbeat, LaunchAgent, or watchdog that can reopen Veritas.
4. Quit every desktop/source server writer. Confirm the desktop process and
   preferred port are stopped before copying data.
5. Preserve the complete workspace, not only the SQLite file. Keep the backup
   through release acceptance.
6. Install v6.0.0 without replacing the workspace.
7. Launch with the same profile. If setup appears for a populated database,
   choose **Use Existing Data**. Do not rerun file migration or restore over the
   populated database.
8. Wait for the exact-version readiness gate:

   ```bash
   EXPECTED_VERSION=6.0.0
   pnpm desktop:wait:ready -- --expected-version "$EXPECTED_VERSION"
   ```

9. Verify `PRAGMA quick_check`, the representative counts, owner metadata,
   provider profile normalization, board/search/task detail, workflows, Squad
   Chat, Maintenance, and `/api/health.version`.
10. Run `vk doctor --json`. Review each enabled profile's support tier,
    version/build, authentication posture, capability evidence, and
    remediation. Do not assume a v5 profile remains Certified.
11. Resume automation only after the app and health versions match and the
    board is accepted.

The public API remains `v1`. v6 adds provider, approval, lifecycle, tool,
credential, compatibility, Buzz, and conformance records without requiring a
new API mount.

### Legacy provider profile normalization

- Known built-in Codex, Hermes, and Claude records migrate only when both type
  and command identity match.
- Provider-less, ambiguous, adapter/profile-mismatched, or unknown records do
  not silently become OpenClaw.
- New Buzz, Grok Build, GitHub Copilot CLI, Codex app-server, Claude Code, and
  generic ACP profiles are disabled by default.
- Unknown provider builds invalidate certification until the reviewed profile
  and deterministic fixture evidence are updated.
- The former Claude Code permission-bypass default is removed. Do not restore
  it through custom arguments.

## Routine Mac Desktop Upgrade

For any later v6 patch:

1. Create and verify a governed backup.
2. Pause auto-reopen automation.
3. Quit Veritas and confirm its app process and port are stopped.
4. Run:

   ```bash
   brew update
   brew upgrade --cask bradgroux/tap/veritas-kanban
   brew list --cask --versions veritas-kanban
   ```

5. Read `CFBundleShortVersionString`, launch the app, and use
   `pnpm desktop:wait:ready -- --expected-version <version>`.
6. Verify the listener belongs to the packaged application, then check the
   board and Maintenance.
7. Resume automation only after exact-version readiness passes.

Homebrew replacement does not launch the app or wait for its bundled server.
Do not substitute an immediate `curl` or fixed sleep for the readiness gate.

## Harness Installation And Authentication

Veritas never installs a third-party harness. Install the exact tested build
from its official distribution, authenticate using the provider's supported
flow, then enable its built-in profile in Settings -> Agents.

| Harness              | Install/verify                                                                                       | Authentication names accepted by the v6 profile                                                                           | Safe default                                                                                                                                   |
| -------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Buzz Agent           | Build/install Buzz v0.4.24 `buzz-agent`; verify ACP identity `buzz-agent 0.1.0`.                     | `ANTHROPIC_API_KEY`, `OPENAI_COMPAT_API_KEY`, or `DATABRICKS_TOKEN`.                                                      | Disabled; no resume; only the system-owned `veritas-run` MCP bridge.                                                                           |
| Grok Build           | Install v0.2.111; run `grok --version`.                                                              | Existing `GROK_HOME`, `XAI_API_KEY`, `GROK_CODE_XAI_API_KEY`, or `GROK_DEPLOYMENT_KEY`.                                   | Disabled; dedicated `agent --no-leader ... stdio`; restrictive policy only.                                                                    |
| Codex CLI/app-server | Install the reviewed Codex CLI; run `codex login status`. App-server certification requires 0.145.0. | Existing Codex login or `OPENAI_API_KEY` where supported.                                                                 | Workspace-write task sandbox; app-server plugins, apps, hooks, browser/computer tools, remote control, and unsandboxed shell command disabled. |
| Codex SDK            | Installed with Veritas as `@openai/codex-sdk 0.144.3`.                                               | Existing Codex login or `OPENAI_API_KEY`.                                                                                 | Shared manifest, sandbox, tool, event, and completion controls.                                                                                |
| Claude Code          | Install 2.1.218; run `claude --version` and `claude auth status`.                                    | `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, Foundry, bounded Bedrock keys, or explicit Vertex credential file reference. | Disabled; `--bare`, `dontAsk`, strict MCP, credential scrubbing; no permission bypass.                                                         |
| GitHub Copilot CLI   | Install v1.0.74; run `copilot --version` and provider login.                                         | `COPILOT_GITHUB_TOKEN`, `COPILOT_PROVIDER_API_KEY`, `COPILOT_PROVIDER_BEARER_TOKEN`, `GH_TOKEN`, or `GITHUB_TOKEN`.       | Disabled; ACP public preview, remote/plugins/custom instructions/experimental features off.                                                    |
| Hermes Agent         | Install v2026.7.7.2; run `hermes --version`.                                                         | `HERMES_API_KEY` or the documented model-provider key.                                                                    | Disabled; one-shot scripted execution.                                                                                                         |
| OpenClaw             | Run v2026.6.11 gateway and verify tool policy.                                                       | `OPENCLAW_GATEWAY_TOKEN` when required.                                                                                   | Explicit gateway URL; `sessions_spawn` and `sessions_send` must be allowed.                                                                    |

Credential values belong in the operator environment or the platform's login
store. Settings, docs, task bodies, screenshots, logs, issue comments, and
support packets must contain only environment key names or opaque references.

After setup:

```bash
vk doctor --json
```

Fix Degraded or Unsupported evidence before dispatch. Detected means the
executable exists but the profile is disabled. Configured is usable adapter
evidence without current certification. Certified requires matching
deterministic evidence; live authentication and quota remain separate facts.

## Buzz Setup

Buzz communication and Buzz Agent execution are independent:

- Configure the relay, public key, `env:BUZZ_PRIVATE_KEY`, optional
  `env:BUZZ_AUTH_TAG`, and one explicit channel mapping under Settings ->
  Notifications.
- Run the read-only compatibility probe before enabling delivery.
- Import public persona/team definitions only through preview and an explicit
  create, link, refresh, or skip action. Imports remain disabled and never
  launch a provider.
- Create only bounded root `message.posted` workflow triggers. Replies, edits,
  deletes, reactions, echoes, replays, and predicate mismatches do not start a
  workflow.
- Configure the separate disabled `buzz-agent` profile only when ACP task
  execution is required.

See [Buzz Integration](BUZZ-INTEGRATION.md) for API examples, channel mapping,
Nostr identity, trigger rules, replay, and rollback.

## Remote And Multi-User Administration

Remote mode remains a trusted-host setup. Serve web, `/api`, `/ws`, health
routes, manifest, service worker, and assets from one HTTPS origin. Keep
`VERITAS_AUTH_ENABLED=true` and
`VERITAS_AUTH_LOCALHOST_BYPASS=false`.

Use scoped device sessions or API tokens for remote browsers, CLI, MCP, agents,
and automation. Never share owner/admin credentials with providers. Approval
reviewer identity, authentication freshness, workspace membership, and exact
action binding are enforced server-side.

Use [Self-Hosting Guide](guides/SELF_HOST.md), the v5 remote security ADR, and
[Identity And RBAC](IDENTITY-RBAC.md) for unchanged remote/server foundations.

## Backup And Recovery

Before upgrade, provider-profile changes, or Buzz setup:

1. Stop or quiesce every writer.
2. Create a governed backup/export and retain its report.
3. Copy the complete workspace after SQLite checkpoint and integrity checks.
4. Store backups away from the live database.
5. Test restore into an isolated profile, never over a running workspace.

Rollback from v6 means reinstalling the prior signed app only when its data
contracts remain compatible. Otherwise restore the stopped-writer v5.2.5
backup. There is no promise of destructive schema down-migration.

For Buzz rollback, disable trigger rules first, then the channel mapping, then
the adapter. Audit records and local Squad Chat content remain. Veritas never
deletes remote Buzz events or writes imported definitions back.

For a provider rollback, disable the changed profile and restore the reviewed
profile configuration from backup. Do not lower support evidence, bypass
permissions, or route an ambiguous record through another adapter.

## Diagnostics

Use:

```bash
vk doctor --json
curl http://127.0.0.1:3001/api/health
curl http://127.0.0.1:3001/health/ready
```

Compare app, server, CLI, MCP, and updater versions. Review redacted
runtime-manifest, support-profile, compatibility-matrix, launch-manifest,
approval, run-event, and completion evidence. Never paste raw private relay
events, provider output, credentials, or unrestricted support bundles into a
public issue.
