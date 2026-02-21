# Getting Started with Veritas Kanban

> **Credit:** This guide exists because **Neal (@nealmummau)** asked how to get Veritas Kanban working with AI agents in under five minutes. Thank you for pushing us to document the real workflow.

Whether you are standing up the board for yourself or for a fleet of agents, this guide walks you from zero ➝ working board ➝ agents picking up work. Each section is short, copy/paste friendly, and mirrors how we run Veritas Kanban internally.

---

## Table of Contents

1. [Prerequisites (30 seconds)](#prerequisites-30-seconds)
2. [Installation & Setup Wizard (manual today, guided tomorrow)](#installation--setup-wizard-manual-today-guided-tomorrow)
3. [Create Your First Task (UI path)](#create-your-first-task-ui-path)
4. [Create Your First Task (API/CLI path)](#create-your-first-task-apicli-path)
5. [Connect an Agent + Agent Pickup Checklist](#connect-an-agent--agent-pickup-checklist)
6. [Sanity Checks & Quick Fixes](#sanity-checks--quick-fixes)
7. [Shared Resources & Prompt Registry](#shared-resources--prompt-registry)
8. [Documentation Freshness & Repo Rules](#documentation-freshness--repo-rules)
9. [Multi-Repo / Multi-Agent Notes](#multi-repo--multi-agent-notes)
10. [OpenClaw Browser Relay (Optional but recommended)](#openclaw-browser-relay-optional-but-recommended)
11. [What's Next?](#whats-next)

---

## Prerequisites (30 seconds)

| What              | Command            | Notes                                              |
| ----------------- | ------------------ | -------------------------------------------------- |
| Node.js           | `node -v`          | Requires **22+**. Install via Volta/nvm if older.  |
| pnpm              | `pnpm -v`          | Requires **9+**. `npm install -g pnpm` if missing. |
| Git               | `git --version`    | Any current version works.                         |
| (Optional) Docker | `docker --version` | Needed only if you prefer containers.              |

That's it. No database, no extra services.

---

## Installation & Setup Wizard

### Quick Start with `vk setup`

After cloning and starting the server, run the setup wizard to verify your environment:

```bash
vk setup
```

This checks Node version, server health, API access, and optionally creates a sample task to get you started.

### Manual Setup

If you prefer step-by-step control, follow the manual wizard below:

### 1. Clone & install

```bash
git clone https://github.com/BradGroux/veritas-kanban.git
cd veritas-kanban
pnpm install
```

### 2. Configure server

a. Copy the sample env

```bash
cp server/.env.example server/.env
```

b. Edit the new file:

- `VERITAS_ADMIN_KEY` → 32+ chars (use `node -e "console.log(crypto.randomBytes(32).toString('hex'))"`)
- `VERITAS_AUTH_ENABLED=true` (default)
- `VERITAS_AUTH_LOCALHOST_BYPASS=true` to avoid auth friction locally
- Optional: set `TRUST_PROXY` when running behind a reverse proxy (nginx, Caddy, Traefik, Synology DSM). For example, `TRUST_PROXY=1` to trust a single proxy hop. See the Deployment Guide for details.
- Optional: set `HOST=127.0.0.1` (avoids proxy ambiguity)

### 3. Start the dev stack

```bash
pnpm dev
```

Web boots on **3000**, API on **3001**. First boot seeds demo tasks so you have something to look at.

![Dev stack running](../assets/demo-overview.gif)

### 4. Run the in-app setup

Visit [http://localhost:3000](http://localhost:3000) → follow the onboarding form:

- Create your admin password
- Save the recovery key (seriously; it's the only way to regain access)
- Log in and confirm you can see the seeded board

> 🧙 **Tip:** Run `vk setup` at any time to verify your environment is correctly configured.

---

## Create Your First Task (UI path)

1. Click **New Task** on the board.
2. Fill title, description (Markdown), pick a type + priority.
3. Optional: assign a sprint/project.
4. Hit **Create** and watch it appear in **Todo**.
5. Drag it to **In Progress** to feel the flow.

![Creating a task via UI](../assets/demo-task.gif)

> Need a clean slate? Remove the example tasks: `rm tasks/active/task_example_*.md`

---

## Create Your First Task (API/CLI path)

### REST call (curl)

```bash
curl -X POST http://localhost:3001/api/tasks \
  -H "Content-Type: application/json" \
  -H "X-API-Key: <YOUR_ADMIN_KEY>" \
  -d '{
    "title": "Wire up MCP server",
    "description": "Create CLI + MCP parity",
    "type": "feature",
    "priority": "high"
  }'
```

### CLI (after `cd cli && npm link`)

```bash
vk create "Wire up MCP server" --type feature --priority high
vk list --status todo
```

CLI commands fully mirror the API and are the fastest way to script agent workflows.

![CLI workflow demo](../assets/demo-drag_drop.gif)

---

## Connect an Agent + Agent Pickup Checklist

Agents interact through HTTP + WebSocket; nothing is hard-coded to a particular provider. Follow this checklist to verify they can pick up work:

1. **Create an agent API key** in `server/.env`:
   ```
   VERITAS_API_KEYS=my-agent:super-secret-key:agent,ops:another-key:admin
   ```
2. **Restart** `pnpm dev` so the key loads.
3. **Create an agent request** (UI → Start Agent) or drop a JSON file in `.veritas-kanban/agent-requests/`.
4. **Watch pending agents** in the UI or via CLI:
   ```bash
   vk agents:pending
   ```
5. **Agent workflow** (example prompt to OpenClaw):
   ```
   Hey Veritas, pick up task <ID>. Set status to in-progress, start the timer, do the work, then call `vk done <id> "summary"` when finished. Use cross-model review if you wrote code.
   ```
6. **Agent completion**
   - Verify `tasks/active/...` reflects status/time tracking
   - Check `.veritas-kanban/logs/agents.log` for run details
   - Confirm UI Agent Status indicator flips back to **Idle**

![Agent status indicator](../assets/demo-task.gif)

> **Automation tip:** Keep a `prompts/` folder (see below) so agents get consistent instructions for sprint planning, reviews, research, etc.

---

## Sanity Checks & Quick Fixes

These cover the "something feels off" moments before you deep-dive logs.

### 1. API health (up in <1s)

```bash
curl -s http://localhost:3001/api/health | jq
```

Expect `{ "ok": true, "service": "veritas-kanban", ... }`. If the call hangs or returns HTML, something else is on the port.

### 2. UI health

- Browser hard refresh (`Cmd/Ctrl + Shift + R`)
- If blank, open devtools → Console for errors.
- Verify WebSocket indicator (top right) shows **Connected**; if not, check proxies/CORS.

### 3. Agent pickup sanity

- `.veritas-kanban/agent-requests/` should have JSON per request. If files accumulate, agents are not acknowledging them.
- `vk agents:pending` returning nothing while UI shows pending usually means API key mismatch; regenerate and restart.

### 4. Common failure modes & instant fixes

| Symptom                     | Quick Fix                                                     |
| --------------------------- | ------------------------------------------------------------- |
| Ports collide / UI hung     | `pnpm dev:clean`                                              |
| Health endpoint returns 404 | Wrong project running on 3001 (restart)                       |
| Auth spamming rate limit    | Ensure request IP is `127.0.0.1` or increase limiter          |
| Agents "never pick up"      | Verify API key role `agent`, check firewall/Docker networking |

For deeper debugging see [docs/TROUBLESHOOTING.md](TROUBLESHOOTING.md).

---

## Shared Resources & Prompt Registry

BoardKit Orchestrator inspired us here: keep prompts, skills, and guidelines in one place so every repo/agent stays in sync.

**Veritas Kanban includes a starter `prompt-registry/` with 10 templates:**

```
prompt-registry/
├── sprint-planning.md      # Break epics into sprints
├── worker-handoff.md       # PM → Worker assignment
├── cross-model-review.md   # Claude ↔ GPT review gate
├── feature-development.md  # E2E feature implementation
├── bug-triage.md           # Investigation and fix
├── research-report.md      # Deep research deliverable
├── task-completion.md      # Pre-completion checklist
├── blocked-escalation.md   # Blocker reporting
├── pm-orchestration.md     # PM agent managing workers
└── standup-summary.md      # Daily status report
```

**Usage:**

1. Reference in task descriptions: `See prompt: prompt-registry/cross-model-review.md`
2. Copy and customize for your team's conventions
3. When spawning agents (OpenClaw `sessions_spawn`), paste the relevant prompt

**Multi-repo setup:** See [SOP-shared-resources.md](SOP-shared-resources.md) for patterns on sharing prompts across multiple repositories.

---

## Documentation Freshness & Repo Rules

Stale docs = hallucinating AI. Keep these files current:

| File                     | Purpose                                                            |
| ------------------------ | ------------------------------------------------------------------ |
| `CLAUDE.md`              | Agent rules, architecture, lessons learned. **Template included.** |
| `AGENTS.md`              | Personality, escalation rules, cross-model review requirement.     |
| `SOUL.md`                | "Who are we?" - tone/voice used by agents.                         |
| `GPT.md` / `CODEX.md`    | Model-specific guardrails (optional).                              |
| `docs/BEST-PRACTICES.md` | Patterns and anti-patterns all agents follow.                      |

**Cadence:**

- Update immediately after a mistake or new learning.
- Run monthly freshness audits (see [SOP-documentation-freshness.md](SOP-documentation-freshness.md)).
- During sprint closure, skim the "Lessons Learned" field on each task and propagate anything evergreen into AGENTS/CLAUDE.

**Automation:** Future versions will include a "Doc Steward" agent that summarizes recent commits and suggests doc updates. See the [Doc Freshness SOP](SOP-documentation-freshness.md) for the roadmap.

---

## Multi-Repo / Multi-Agent Notes

Running multiple projects or repos with the same agent pool? Borrow BoardKit's approach:

- Keep shared assets (skills, prompts, SOPs) under a top-level `shared/` folder.
- For each repo, mount/symlink only what you need (manual today; native support in US-1611).
- Use consistent naming for agent API keys so dashboards stay readable (`project-agent-name`).
- Record sub-agent usage with `vk agent sub-agent <count>` so the Agent Status sidebar matches reality.

---

## OpenClaw Browser Relay (Optional but Recommended)

For auth-required workflows (LinkedIn research, dashboards behind Okta, etc.) you'll want OpenClaw's Browser Relay:

1. Install the extension + helper from the [OpenClaw docs](https://github.com/openclaw/openclaw).
2. Launch the relay; attach your tab.
3. Agents can now run headless instructions through your actual browser session while respecting your credentials.

This is invaluable for Champions-style research tasks or anything needing a real login flow.

---

## What's Next?

1. Read the SOPs:
   - [Agent Task Workflow](SOP-agent-task-workflow.md)
   - [Sprint Planning with AI Agents](SOP-sprint-planning.md)
   - [Multi-Agent Orchestration](SOP-multi-agent-orchestration.md)
   - [Cross-Model Code Review](SOP-cross-model-code-review.md)
   - [Documentation Freshness](SOP-documentation-freshness.md)
   - [Shared Resources](SOP-shared-resources.md)
   - [Lifecycle Hooks](SOP-lifecycle-hooks.md)
2. Align on [Best Practices](BEST-PRACTICES.md) & [Tips + Tricks](TIPS-AND-TRICKS.md).
3. Browse [Real-world Examples](EXAMPLES-agent-workflows.md) and steal the prompts.
4. Keep `docs/TROUBLESHOOTING.md` handy for deeper diagnostics.

You now have a board, agents that can pick up work, and a safety net when things wobble. Go ship something.
