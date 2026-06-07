# Veritas Kanban v5 Visual Tour

This page is the v5 documentation media index. The screenshots and GIFs use
release-safe dummy content captured from the current app surfaces so the docs
can show realistic workflows without exposing real tasks, prompts, logs, paths,
tokens, or customer data.

## Capture Set

| Asset                  | Path                                       | Notes                                                                           |
| ---------------------- | ------------------------------------------ | ------------------------------------------------------------------------------- |
| Board to workflow tour | `docs/assets/v5/v5-board-to-workflow.gif`  | Desktop board, task detail, Workflows, and More Views flow.                     |
| Board overview         | `docs/assets/v5/v5-board-overview.png`     | Current dark-mode board with v5 dummy tasks and live agent registry data.       |
| Desktop shell          | `docs/assets/v5/v5-desktop-shell.png`      | Native-app-style shell with toolbar, workspace selector, and health rail.       |
| Workbench panel        | `docs/assets/v5/v5-workbench-panel.png`    | Resizable bottom Workbench with Board Chat and Squad Chat tabs.                 |
| Agent providers        | `docs/assets/v5/v5-agent-providers.png`    | Settings -> Agents with Codex default, Ollama Local/Cloud, and LM Studio Local. |
| Task work view         | `docs/assets/v5/v5-task-work-view.png`     | Task detail drawer with dummy v5 release smoke content.                         |
| Maintenance Center     | `docs/assets/v5/v5-maintenance-center.png` | Operator diagnostics, storage, cleanup preview, and redacted evidence surfaces. |
| Mobile/PWA board       | `docs/assets/v5/v5-mobile-pwa-board.png`   | Phone-width board shell with mobile navigation.                                 |
| Mobile/PWA flow        | `docs/assets/v5/v5-mobile-pwa-flow.gif`    | Mobile board, Runs, and Settings navigation flow.                               |

## Desktop Board And Workflow

![v5 board to workflow tour](assets/v5/v5-board-to-workflow.gif)

The desktop tour shows the current board chrome, seeded release tasks, task
detail drawer, workflow route, and More Views menu. It is intentionally dummy
data, but it uses the real web app and a throwaway local server.

![v5 board overview](assets/v5/v5-board-overview.png)

![v5 desktop shell](assets/v5/v5-desktop-shell.png)

## Workbench And Chat

![v5 Workbench bottom panel](assets/v5/v5-workbench-panel.png)

The Workbench capture shows the bottom panel as a first-class app surface
instead of a floating off-screen chat control. Board Chat and Squad Chat share
the panel, and the panel can be collapsed or resized vertically.

## Agent Provider Settings

![v5 agent provider settings](assets/v5/v5-agent-providers.png)

Fresh installs use Codex as the default agent profile. Ollama Local, Ollama
Cloud, and LM Studio Local are available as optional routing targets for users
who want local/server-hosted models or explicit cloud model execution.

## Task Work View

![v5 task work view](assets/v5/v5-task-work-view.png)

The task work view capture uses a dummy signed Mac app smoke task. It exists to
show the current detail drawer, tabs, release-task metadata, subtasks, and done
criteria layout in v5 docs.

## Maintenance Center

![v5 Maintenance Center](assets/v5/v5-maintenance-center.png)

The Maintenance Center capture uses mocked, redacted support data for health
checks, storage usage, cleanup preview, log tails, backup/import controls, and
lifecycle policy. No real local paths or tokens are included.

## Mobile/PWA

![v5 mobile PWA board](assets/v5/v5-mobile-pwa-board.png)

![v5 mobile PWA flow](assets/v5/v5-mobile-pwa-flow.gif)

The mobile captures show the responsive board and bottom navigation for trusted
mobile/PWA access. They do not claim native offline execution; v5 PWA offline
behavior remains static-shell-only as documented in the release notes and admin
guide.

## Documentation Use

Use this page when completing:

- [v5 GA Checklist](V5-GA-CHECKLIST.md)
- [v5 Upgrade, Install, Remote, And Admin Guide](V5-UPGRADE-INSTALL-ADMIN-GUIDE.md)
- [v5.0 Release Notes](V5-RELEASE-NOTES.md)

These dummy captures are documentation assets, not release proof. Future
release-candidate evidence belongs in the reusable
[v5 Release Candidate Evidence Packet](V5-RC-EVIDENCE-PACKET.md) or the linked
GitHub release issue for that candidate.
