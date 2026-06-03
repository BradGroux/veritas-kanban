# Product Modes

Product modes are persisted UX preferences for focused Veritas workflows. They tune the default mental model for dashboards, task templates, visible panels, and command shortcuts without changing API access or deleting user configuration.

## Modes

| Mode                | Best for                   | Default emphasis                                     |
| ------------------- | -------------------------- | ---------------------------------------------------- |
| Board Only          | Simple local task tracking | Board, backlog, archive, basic search                |
| Agent Ready         | Local agent work           | Agent panel, templates, work products, run history   |
| Solo Coding         | Implementation tasks       | Repo, branch, QA gate, completion packet surfaces    |
| PM Orchestration    | Coordinated delivery       | Workflows, decisions, policy traces, dashboards      |
| QA Review           | Verification and handoff   | Needs Attention, QA gates, evidence, workflow runs   |
| Research            | Read-heavy work            | Search, shared resources, notes, decision records    |
| Operations          | Runtime management         | Maintenance, health, backup, remote-session surfaces |
| Advanced / Operator | Full control plane         | All surfaces visible                                 |
| Custom              | Manual tuning              | Records preference only                              |

## Persistence

The selected mode is stored in `features.productMode.selectedMode`. Existing users default to `advanced` so no current panels are hidden on upgrade. First-run desktop onboarding records a pending mode in local storage, then applies it to settings after password setup and authentication.

Modes should hide or de-emphasize optional surfaces in the UI only. Route handlers, APIs, troubleshooting controls, and stored user data remain available.
