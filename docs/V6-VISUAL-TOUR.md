# Veritas Kanban v6 Visual Tour

The maintained views below are retained 6.2.0 captures. Their labels and provenance stay unchanged until the final 6.3.0 signed candidate produces fresh original media; they are not 6.3.0 visual acceptance. The latest published stable release is 6.2.1. See the [6.3.0 release source](releases/v6.3.0.md), [evidence packet](V6-RC-EVIDENCE-PACKET.md), and [media contract](design/DOCUMENTATION-MEDIA-CONTRACT.md).

Documentation freshness: 2026-10-23 for release preparation; the maintained media refresh is pending. Historical [6.2.0 comparison](releases/v6.2.0-comparison.md) and [capture provenance](assets/v6.2.0/README.md) remain available.

## Board And Task Workspace

The board uses the current semantic column states, compact task cards, shared
desktop shell, and Workbench affordance. Opening a task replaces the former
peer-tab drawer with progressive Overview, Plan, Run, Results, and History
modes.

![6.2.0 board overview with release-safe tasks](assets/v6.2.0/board-overview.png)

![6.2.0 progressive task workspace](assets/v6.2.0/task-workspace.png)

![6.2.0 board-to-task interaction](assets/v6.2.0/board-to-workspace.gif)

## Grouped Settings And Command Palette

Settings groups all twenty destinations under Core, Collaboration, Automation,
Governance, and System while keeping transfer and danger-zone actions separate.
Command+K uses the same current shell and remains bounded to the viewport.

![6.2.0 grouped Settings navigation](assets/v6.2.0/settings-navigation.png)

![6.2.0 Command+K palette](assets/v6.2.0/command-palette.png)

## Provider Support

Settings -> Agents shows the normalized support tier, installed version/build,
configuration readiness, certification freshness, limitations, and
remediation from the same `harness-support-profile/v1` and
`harness-compatibility-matrix/v1` records used by `vk doctor --json`, API
diagnostics, dispatch, and telemetry.

The release capture must use dummy profile names and contain no login state,
environment values, provider output, private paths, or credentials.

![6.2.0 provider settings with current grouped navigation](assets/v6.2.0/agent-providers.png)

Expected visible behavior:

- Buzz, Grok Build, Codex app-server, Claude Code, and GitHub Copilot CLI show
  their reviewed exact build and source-availability caveat.
- Disabled installed profiles read Detected rather than Certified.
- Stale/unknown builds read Degraded or Unsupported with an actionable reason.
- Provider controls unsupported by the current manifest are not presented as
  silently available.

## Buzz Integration

Settings -> Notifications -> Buzz Connection keeps relay communication
separate from Buzz Agent execution. The connection view exposes reference-only
URLs, public identity, environment-variable references, compatibility facets,
one-channel mappings, definition preview/import, trigger rules, and bounded
audit state.

![6.2.0 communication health, Buzz, and reply-adapter settings](assets/v6.2.0/notification-adapters.png)

Expected visible behavior:

- private keys and auth tags appear only as environment reference names;
- compatibility failure disables delivery;
- persona/team import is preview-first and creates disabled objects;
- workflow triggers accept root `message.posted` only;
- replay, reply, edit, delete, reaction, echo, and disabled-rule dispositions
  are visible without launching duplicate workflow runs.

## Approval And Run Evidence

Task Detail and shared-run views project the causal `run-event/v1` journal,
exact-action approval requests, conversation lifecycle controls, tool/MCP
evidence, worktree/launch identity, usage, artifacts, and authoritative
completion result.

No public-safe approval was active in the isolated release profile. The text
contract below is retained instead of fabricating a passing approval state.

Expected visible behavior:

- approval copy identifies the exact action and risk without showing secret
  values;
- stale, expired, changed, cancelled, or already-decided requests cannot be
  approved;
- resume, steer, fork, compact, archive, interrupt, and close appear only when
  current provider evidence supports them;
- reconnect replays causal events by cursor without duplicating completion;
- mobile-safe questions remain separate from filesystem, command, network,
  permission, and MCP approval.

## Workbench, Squad Chat, Maintenance, And Mobile

| Surface            | Current 6.2.0 capture                                             |
| ------------------ | ----------------------------------------------------------------- |
| Workbench          | ![Workbench](assets/v6.2.0/workbench-panel.png)                   |
| Squad Chat         | ![Squad Chat](assets/v6.2.0/squad-chat.png)                       |
| Maintenance        | ![Maintenance](assets/v6.2.0/maintenance-center.png)              |
| Mobile board       | ![Mobile board](assets/v6.2.0/mobile-board.png)                   |
| Mobile task        | ![Mobile task workspace](assets/v6.2.0/mobile-task-workspace.png) |
| Mobile Settings    | ![Mobile Settings](assets/v6.2.0/mobile-settings.png)             |
| Mobile guided tour | ![Mobile flow](assets/v6.2.0/mobile-flow.gif)                     |

## Capture Rules

Follow the [documentation media contract](design/DOCUMENTATION-MEDIA-CONTRACT.md).
Run `pnpm docs:capture-media <candidate.app> <new-external-directory>` from a
clean candidate checkout on macOS. The output directory must not already exist.
The runner launches the actual packaged application in an isolated profile,
captures the mobile browser separately, and records real interactions at 8 fps.
It requires `ffmpeg` and the pinned Playwright Chromium installation.

The original capture files and manifest remain outside the repository. After
visual inspection and complete GIF/MP4 playback, copy the exact bytes to the
versioned media paths and commit only documentation/media changes. Run
`pnpm docs:verify-media <capture/evidence.json> <candidate.app> <capture/publication.json>`
from that clean documentation commit. This verifies original, committed and
working-copy hashes without recapturing or relabeling an older build.

Before publication, retain only verified screenshots captured from an isolated
runtime without private data. If a state cannot be safely produced, retain the
text contract and record the missing visual evidence in the release packet
rather than fabricating a screenshot.

Capture desktop dark/light and compact widths where the state materially
changes. Verify keyboard focus, labels, contrast, and recoverable error copy.
Never capture credentials, private provider conversations, relay events,
tokens, local user paths, or unrestricted diagnostics.
