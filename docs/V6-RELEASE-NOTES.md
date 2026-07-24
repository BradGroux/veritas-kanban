# Veritas Kanban 6.0.2 Release Notes

Veritas Kanban 6.0.2 is a desktop recovery and supportability hotfix for the
first stable v6 line. It prevents Chat from trapping the application window,
adds authoritative native version/build information, and keeps verification
focused between release milestones.

> Veritas Kanban 6.0.0 remains a quarantined prerelease. Version 6.0.2
> supersedes 6.0.1 as the supported stable v6 release.

## Desktop Recovery Hotfix

### Chat stays inside the application shell

Board Chat and Squad Chat now open in a right-side Workbench dock by default.
The same active conversation can switch between Right and Bottom without
remounting. The dock clamps its width or height to the live viewport, owns its
scrolling, and cannot move or cover the entire application shell.

Close, Escape, browser Back, and Reset Layout all return to a visible board and
restore focus. Invalid or obsolete persisted dimensions recover to the safe
right-dock default on startup
([#1004](https://github.com/BradGroux/veritas-kanban/issues/1004)).

### Native About and offline support information

The desktop application now exposes **About Veritas Kanban** and **Copy Version
Information** in its native application menu. Both use Electron's authoritative
application record and include:

- application name and identifier;
- exact semantic version;
- embedded release commit/build identity;
- stable, beta, or development channel;
- operating system version and architecture; and
- packaged versus development state.

The native About panel, copied support text, desktop bridge, and updater
fallback all consume the same record. Operators can capture exact diagnostics
without opening Settings, the renderer, or a network connection
([#1005](https://github.com/BradGroux/veritas-kanban/issues/1005)).

### Proportional CI verification

CI now selects documentation-only, focused, or full verification from the
reviewed change range. Ordinary code changes run affected Vitest coverage;
high-risk, shared, storage, manifest, and release changes retain the full gate.
A successful reviewed full-suite head can be reused after merge only when it is
an ancestor of the resulting commit. Scheduled and explicit release gates
remain authoritative
([#1000](https://github.com/BradGroux/veritas-kanban/issues/1000)).

## Harness Support

The v6 harness control plane and compatibility claims introduced in 6.0.1 are
unchanged:

- Buzz Agent, Grok Build, and GitHub Copilot CLI use the shared ACP v1 adapter.
- OpenAI Codex supports CLI, SDK, and app-server lifecycles.
- Claude Code uses a supervised bare-mode stream.
- Hermes and OpenClaw retain their one-shot and gateway transports.
- Settings, API diagnostics, telemetry, dispatch, and `vk doctor --json`
  report the same support tier and redacted readiness evidence.

Equal footing does not pretend every provider supports the same controls.
Veritas probes the installed version and capabilities, persists that evidence,
and blocks unsupported lifecycle, tool, approval, sandbox, or completion
behavior before attempt creation.

Buzz communication remains separate from task authority. The relay transports
signed messages; Veritas owns tasks, attempts, tools, approvals, and completion.

## Install Or Upgrade

### Homebrew

```bash
brew update
brew upgrade --cask bradgroux/tap/veritas-kanban
```

For a first installation:

```bash
brew install --cask bradgroux/tap/veritas-kanban
```

### Direct download

Download the signed and notarized macOS arm64 DMG or ZIP from the
[v6.0.2 release](https://github.com/BradGroux/veritas-kanban/releases/tag/v6.0.2).

Back up the current workspace before upgrading. Keep the backup until the new
runtime is accepted. Follow the
[v6 upgrade and administration guide](V6-UPGRADE-INSTALL-ADMIN-GUIDE.md) for
exact readiness, data-preservation, diagnostics, and rollback procedures.

## Breaking Changes And Migration Warnings

- Version 6.0.2 does not add a new data-schema migration over 6.0.1.
- Do not install the quarantined 6.0.0 prerelease.
- Provider-less or adapter/profile-mismatched records do not fall through to
  OpenClaw.
- Unknown or changed provider builds lose certification until current probes
  and deterministic fixtures pass.
- Claude Code does not launch with `--dangerously-skip-permissions`.
- Credential-bound MCP servers are available only through the mediated
  run-scoped bridge.
- The public REST API remains mounted at `v1`; the v6 product version does not
  rename API routes.

Upgrade from v5.2.5 only after a governed backup. If rollback requires an older
schema, restore the stopped-writer pre-upgrade backup instead of opening newer
data with an incompatible binary.

## Known Limitations

- Buzz Agent sessions are in-memory and do not support session load/resume.
  Buzz files, reactions, forums, DMs, and destructive edit/delete projection
  are not bridged.
- GitHub Copilot CLI ACP remains public preview.
- Grok Build's stable artifact self-reports alpha and cannot be fully traced to
  the current public source tree.
- Claude Code's complete CLI implementation is not public, so certification is
  bound to exact release behavior and checked-in fixtures.
- Linux and Windows desktop artifacts remain unsigned previews. Signed and
  notarized macOS arm64 is the supported desktop distribution.
- Deterministic compatibility does not prove provider authentication,
  subscription availability, quota, or live inference.

## Release Artifacts

The supported stable desktop release publishes these assets from the annotated
`v6.0.2` tag:

- signed and notarized `Veritas-Kanban-6.0.2-mac-arm64.dmg`;
- signed and notarized `Veritas-Kanban-6.0.2-mac-arm64.zip`;
- DMG and ZIP blockmaps;
- SHA-256 sidecars; and
- `latest-mac.yml` updater metadata.

Linux and Windows builds are verification previews, not stable signed
distribution artifacts. Exact byte sizes, GitHub digests, signature,
Gatekeeper, stapling, updater, and downloaded-app evidence are recorded in the
[v6 release candidate evidence packet](V6-RC-EVIDENCE-PACKET.md).

## Documentation And Evidence

- [Agent guide and reusable `AGENTS.md` template](AGENTS-TEMPLATE.md)
- [Agent provider setup and operations](AGENT-PROVIDERS.md)
- [Harness compatibility matrix](HARNESS-COMPATIBILITY.md)
- [Buzz integration guide](BUZZ-INTEGRATION.md)
- [v6 runtime architecture](architecture/V6-AGENT-RUNTIME-CONTROL-PLANE.md)
- [v6 compatibility and release policy](V6-COMPATIBILITY-AND-RELEASE-POLICY.md)
- [v6 GA checklist](V6-GA-CHECKLIST.md)
- [Release issue #1010](https://github.com/BradGroux/veritas-kanban/issues/1010)
- [Buzz epic #904](https://github.com/BradGroux/veritas-kanban/issues/904)
- [Equal-footing harness epic #915](https://github.com/BradGroux/veritas-kanban/issues/915)
