# Agent Providers

Veritas works as a board without any agent runner. When you do enable agents, provider profiles are configured in **Settings -> Agents** and are stored in the same app config for the web app and the macOS desktop app.

![Agent provider settings](assets/v5/v5-agent-providers.png)

## Defaults

Fresh v5 installs use OpenAI Codex as the default agent:

- `codex` is enabled by default and uses `codex exec --sandbox workspace-write --json`.
- `claude-code`, `amp`, `copilot`, `gemini`, `codex-sdk`, `codex-cloud`, `hermes`, `ollama-local`, `ollama-cloud`, and `lm-studio-local` are available as profiles you can enable or route to.
- Built-in routing sends code, bug, documentation, and review work to `codex` first, with conservative fallbacks for higher-risk code paths.

Existing configs keep the user's chosen default agent. Missing built-in profiles are added during config normalization without overwriting customized commands, arguments, or enabled states.

## Provider Runtime Manifests

Before a task attempt mutates task state, the selected execution adapter emits a
`provider-runtime-manifest/v1` snapshot. The snapshot records the adapter and
protocol version, provider build/version evidence, configured models, probe
timestamp and diagnostics, and every known runtime or sandbox capability as
`supported`, `advisory`, `unsupported`, or `unknown`.

Veritas currently has executable task adapters for `codex-cli`, `codex-sdk`,
`hermes-cli`, and `openclaw`. An explicitly configured Codex Cloud, Ollama, LM
Studio, or custom profile is not silently sent through OpenClaw; task dispatch
fails with an actionable `409` until that provider has an execution adapter.

The exact manifest and its `sha256:` digest are stored on the current attempt,
attempt history, optional run trace, and Markdown run log. Provider identity
evidence is collected on each launch. CLI/SDK identities come from bounded
runtime or installed-package probes, and conformance probes are bounded before
launch. An OpenClaw version supplied through the environment remains degraded
operator evidence until host registration can verify it. A matching
version/build can reuse conformance evidence for up to five minutes; a version
change invalidates it and reruns the probe. Failed probes and unknown versions
are not positively cached.

Capability states describe behavior that the current adapter actually proves.
They do not imply that adjacent roadmap work already exists. For example,
provider-neutral approvals, reattachment, follow-up/fork/steer controls, and MCP
governance remain unsupported or unknown until their dedicated issues land.

## Sandbox Policy Presets

Use **Settings -> Agents -> Sandbox Policies** to manage reusable filesystem, network, environment, and credential controls for agent execution. Built-in presets are immutable; custom presets can be created, edited, disabled, or deleted.

Presets can be assigned to:

- An agent profile, as the default guardrail for that provider.
- A workflow agent, as the guardrail for that workflow role.
- A one-off agent start request, by passing `sandboxPresetId`.

The launch path dry-runs the selected preset before starting Codex CLI, Codex SDK, or OpenClaw-backed work. Required controls fail closed when the provider cannot support them. Advisory controls continue with warnings and a governance trace. Settings also includes a dry-run panel that shows effective sandbox mode, network access, environment allowlist, unsupported controls, and the trace ID.

Credential references and environment-style `name=value` values are redacted from dry-run output and governance traces. Prefer brokered credential presets for workflows that need scoped secrets instead of exposing broad environment passthrough.

## Agent Profile Packages

Use **Settings -> Agents -> Agent Profile Packages** or `vk profiles` to import reusable YAML/JSON packages that sit above provider profiles. Provider profiles still own low-level command, args, and availability. Profile packages add portable launch metadata:

```yaml
id: docs-reviewer
schemaVersion: agent-profile-package/v1
version: 1.0.0
displayName: Documentation Reviewer
role: Reviews documentation changes for accuracy and release readiness
enabled: true
capabilities: [docs-review, release-notes]
defaultTaskTypes: [docs]
runtime:
  agent: codex
  provider: codex-cli
  model: gpt-5.1
instructions:
  prompt: Check docs against shipped behavior and call out stale roadmap language.
tools:
  allowed: [shell, git]
permissions:
  level: specialist
policy:
  sandboxPresetId: workspace-write-default
```

Profile launches pass `profileId` to `/api/agents/:taskId/start`. Veritas resolves the package runtime against the configured provider profile, applies the package model, sandbox preset, and budget policy, injects package instructions into the run prompt, and records the profile ID/version in the task attempt plus an `agent_event` activity entry.

## Budget Policies

Use **Settings -> Agents** and **Settings -> Data & Storage -> Budget Tracking** to define workspace defaults, agent defaults, workflow budgets, workflow-agent budgets, and per-run overrides. Budgets can cap tokens, provider-reported cost, tool calls, runtime, retries, and workflow fan-out.

Soft thresholds create `budget-policy` governance traces and visible warnings. Hard thresholds can pause for review, require approval, downgrade to a configured model, or cancel the run. Completion packets include the final budget decision, usage, threshold events, related trace IDs, and operator override notes when present.

## Local And Cloud Profiles

| Profile            | Provider          | Default command                               | Auth / readiness                                             |
| ------------------ | ----------------- | --------------------------------------------- | ------------------------------------------------------------ |
| OpenAI Codex       | `codex-cli`       | `codex exec --sandbox workspace-write --json` | `codex login status`                                         |
| OpenAI Codex SDK   | `codex-sdk`       | `codex`                                       | SDK import plus Codex login                                  |
| OpenAI Codex Cloud | `codex-cloud`     | `gh`                                          | `gh auth status`                                             |
| Hermes Agent       | `hermes-cli`      | `hermes`                                      | `hermes --version` + `HERMES_API_KEY` or `ANTHROPIC_API_KEY` |
| Ollama Local       | `ollama-local`    | `ollama run llama3.2`                         | `ollama list`                                                |
| Ollama Cloud       | `ollama-cloud`    | `ollama run gpt-oss:120b-cloud`               | `ollama signin` or `OLLAMA_API_KEY`                          |
| LM Studio Local    | `lm-studio-local` | `lms server status`                           | `lms server status --json --quiet`                           |

Ollama local API access does not require authentication on `localhost:11434`; cloud models require either `ollama signin` from the local install or an `OLLAMA_API_KEY`. See the official Ollama authentication docs: <https://docs.ollama.com/api/authentication>.

LM Studio local serving is controlled by the `lms` CLI. `lms server start` starts the local API server, and `lms server status --json --quiet` returns machine-readable readiness. See the official LM Studio CLI docs: <https://lmstudio.ai/docs/cli/serve/server-status>.

## Web App Vs macOS App

The provider model is the same in both shells:

- The web app talks to the Veritas server. Local providers execute on the server host, not on the browser machine.
- The macOS app bundles and supervises the local Veritas server. Local providers execute on that Mac.
- Cloud profiles are still explicit. Routing a local workflow to a cloud provider surfaces a warning during workflow dry-runs.
- Remote or cloud clients should not route directly to local-only providers unless a trusted local host/supervisor is configured.

Sandbox policy enforcement follows the execution host:

- **Local desktop:** filesystem paths, environment passthrough, credentials, and network controls apply on the user's Mac through the bundled server/provider process.
- **Remote server:** the same presets apply on the remote Veritas server host. Browser and mobile clients never receive direct local filesystem access.
- **Cloud-hosted runners:** only provider-reported controls can be treated as enforced. Required controls fail closed when the cloud provider cannot prove support; advisory controls continue with traceable warnings.

## Routing

Use **Settings -> Agents -> Agent Routing** to change defaults. A route can match task type, priority, project, or subtask count, then choose an agent, model override, and fallback.

Recommended starting point:

1. Keep `codex` as the default for general software work.
2. Enable `ollama-local` or `lm-studio-local` for local model experiments where privacy and offline operation matter more than model capability.
3. Enable `ollama-cloud` only when the workflow is allowed to leave local execution.
4. Use explicit routing rules for local LLM profiles instead of making them global defaults on teams with mixed operating systems.

---

## Hermes Agent (v2026.7.7.2)

**Provider ID:** `hermes-cli`  
**Tested version:** Hermes Agent v2026.7.7.2

### Overview

Hermes Agent is dispatched using its non-interactive one-shot scripted interface. Veritas spawns
`hermes -z <prompt>` in the task worktree without a shell, captures the final response from
stdout, and uses the exit code to determine success or failure. Hermes reads `AGENTS.md` from the
worktree root automatically.

### Setup

1. Install Hermes via the official distribution channel for your platform.
2. Verify installation: `hermes --version`
3. Set `HERMES_API_KEY` or `ANTHROPIC_API_KEY` in the Veritas server environment.
4. Enable the Hermes provider in **Settings → Agents** and set **Command** to `hermes`.
5. Set **Provider** to `hermes-cli`.

### Environment

Only the following keys are forwarded to the Hermes subprocess (plus any keys in the sandbox
passthrough list): `ANTHROPIC_API_KEY`, `HERMES_API_KEY`, `HERMES_CONFIG_DIR`, `HOME`, `PATH`,
`SHELL`, `TERM`, `TMPDIR`, `USER`, `LANG`, `VK_API_URL`. All other environment variables are
filtered out.

### Invocation mode

| Mode          | Command              | Notes                                            |
| ------------- | -------------------- | ------------------------------------------------ |
| One-shot task | `hermes -z <prompt>` | Final response text only; used for task dispatch |
| Version probe | `hermes --version`   | Used by readiness / health checks                |

### Limitations

- **Session resume** (`--resume` / `--continue`) is not implemented in this release. Hermes runs
  are one-shot only. Resume support is tracked for a future iteration.
- Stop/cancel sends `SIGTERM` to the subprocess, with a 5-second `SIGKILL` fallback.
- OpenClaw-style callback is not used; Veritas receives the final result directly from the Hermes
  process exit and stdout.

### Troubleshooting

| Symptom                         | Fix                                                       |
| ------------------------------- | --------------------------------------------------------- |
| `Executable "hermes" not found` | Install Hermes and ensure its directory is on `PATH`      |
| `authenticated: null` in health | Set `HERMES_API_KEY` or `ANTHROPIC_API_KEY` in server env |
| Empty stdout on exit 0          | Check `AGENTS.md` is present in the worktree root         |
| Non-zero exit, no clear error   | Inspect stderr in the agent log: `.veritas-kanban/logs/`  |

---

## OpenClaw (v2026.6.11)

**Provider ID:** `openclaw`  
**Tested version:** OpenClaw v2026.6.11

### Overview

OpenClaw task and workflow runs are dispatched through the OpenClaw gateway HTTP API using
`POST /tools/invoke` with the `sessions_spawn` tool. The spawn acknowledgement is the reachability
and policy check: if it fails, Veritas returns an actionable configuration error and rolls the
attempt back to `todo` rather than leaving it in a stuck `running` state. Veritas does not issue a
separate probe because OpenClaw v2026.6.11 ignores the endpoint's reserved `dryRun` field.

### Required gateway tool policy

`sessions_spawn` and `sessions_send` are **blocked by default** in a fresh OpenClaw v2026.6.11
install at the operator-level endpoint. You must explicitly allow them:

1. Add `sessions_spawn` to `gateway.tools.allow` in the OpenClaw configuration.
2. Add `sessions_send` too if workflow session reuse is enabled.
3. Confirm the active agent/tool profile also permits these tools.
4. Save the configuration and restart the gateway.

### Setup

1. Run an OpenClaw v2026.6.11 instance locally or on a reachable host.
2. Configure the gateway tool policy (see above).
3. Set `OPENCLAW_GATEWAY_URL` to the gateway base URL (default: `http://127.0.0.1:18789`).
4. Optionally set `OPENCLAW_GATEWAY_TOKEN` for bearer-authenticated gateways.
5. Enable the OpenClaw provider profile in **Settings → Agents**.

### Environment variables

| Variable                         | Default                  | Purpose                                                                                  |
| -------------------------------- | ------------------------ | ---------------------------------------------------------------------------------------- |
| `OPENCLAW_GATEWAY_URL`           | `http://127.0.0.1:18789` | Gateway base URL                                                                         |
| `OPENCLAW_GATEWAY_TOKEN`         | _(none)_                 | Bearer token for the gateway                                                             |
| `OPENCLAW_GATEWAY_SESSION_KEY`   | `main`                   | Parent session key                                                                       |
| `OPENCLAW_GATEWAY_ALLOW_PRIVATE` | `false`                  | Allow private IP gateway URLs                                                            |
| `OPENCLAW_GATEWAY_VERSION`       | _(none)_                 | Operator-declared version hint; the manifest remains degraded until runtime verification |

### Dispatch flow

1. Veritas calls `sessions_spawn` with the full task prompt (including the
   callback URL: `http://localhost:3001/api/agents/<taskId>/complete`).
2. A policy or connection failure rolls the task attempt back to `todo` with an error message.
3. OpenClaw returns a `childSessionKey` which Veritas stores in the attempt record.
4. The OpenClaw sub-session runs autonomously and calls the Veritas callback URL when done.

### Limitations

- Stop/cancel is not supported for individual sub-sessions in OpenClaw v2026.6.11. A stop request
  logs a warning but cannot forcibly terminate the sub-session.
- Session resume is driven by the callback flow; no explicit `--resume` flag is used.
- OpenClaw v2026.6.11 does not accept per-spawn run timeouts. Configure
  `agents.defaults.subagents.runTimeoutSeconds` in OpenClaw instead.

### Troubleshooting

| Symptom                                                      | Fix                                                                                     |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| `sessions_spawn is not allowed` on start                     | Add `sessions_spawn` to `gateway.tools.allow`; add `sessions_send` for workflow reuse   |
| `OpenClaw gateway did not respond`                           | Check `OPENCLAW_GATEWAY_URL` and gateway process is running                             |
| Task stuck in `running` after old request files appear       | Old request-file artifacts can be safely deleted from `.veritas-kanban/agent-requests/` |
| `OpenClaw sessions_spawn did not return a child session key` | Verify the gateway is running OpenClaw v2026.6.11 or later                              |
