# Agent Providers

Veritas works as a board without any agent runner. When you do enable agents, provider profiles are configured in **Settings -> Agents** and are stored in the same app config for the web app and the macOS desktop app.

![Agent provider settings](assets/v5/v5-agent-providers.png)

## Defaults

Fresh v5 installs use OpenAI Codex as the default agent:

- `codex` is enabled by default and uses `codex exec --sandbox workspace-write --json`.
- `claude-code`, `amp`, `copilot`, `gemini`, `codex-sdk`, `codex-cloud`, `ollama-local`, `ollama-cloud`, and `lm-studio-local` are available as profiles you can enable or route to.
- Built-in routing sends code, bug, documentation, and review work to `codex` first, with conservative fallbacks for higher-risk code paths.

Existing configs keep the user's chosen default agent. Missing built-in profiles are added during config normalization without overwriting customized commands, arguments, or enabled states.

## Sandbox Policy Presets

Use **Settings -> Agents -> Sandbox Policies** to manage reusable filesystem, network, environment, and credential controls for agent execution. Built-in presets are immutable; custom presets can be created, edited, disabled, or deleted.

Presets can be assigned to:

- An agent profile, as the default guardrail for that provider.
- A workflow agent, as the guardrail for that workflow role.
- A one-off agent start request, by passing `sandboxPresetId`.

The launch path dry-runs the selected preset before starting Codex CLI, Codex SDK, or OpenClaw-backed work. Required controls fail closed when the provider cannot support them. Advisory controls continue with warnings and a governance trace. Settings also includes a dry-run panel that shows effective sandbox mode, network access, environment allowlist, unsupported controls, and the trace ID.

Credential references and environment-style `name=value` values are redacted from dry-run output and governance traces. Prefer brokered credential presets for workflows that need scoped secrets instead of exposing broad environment passthrough.

## Budget Policies

Use **Settings -> Agents** and **Settings -> Data & Storage -> Budget Tracking** to define workspace defaults, agent defaults, workflow budgets, workflow-agent budgets, and per-run overrides. Budgets can cap tokens, provider-reported cost, tool calls, runtime, retries, and workflow fan-out.

Soft thresholds create `budget-policy` governance traces and visible warnings. Hard thresholds can pause for review, require approval, downgrade to a configured model, or cancel the run. Completion packets include the final budget decision, usage, threshold events, related trace IDs, and operator override notes when present.

## Local And Cloud Profiles

| Profile            | Provider          | Default command                               | Auth / readiness                    |
| ------------------ | ----------------- | --------------------------------------------- | ----------------------------------- |
| OpenAI Codex       | `codex-cli`       | `codex exec --sandbox workspace-write --json` | `codex login status`                |
| OpenAI Codex SDK   | `codex-sdk`       | `codex`                                       | SDK import plus Codex login         |
| OpenAI Codex Cloud | `codex-cloud`     | `gh`                                          | `gh auth status`                    |
| Ollama Local       | `ollama-local`    | `ollama run llama3.2`                         | `ollama list`                       |
| Ollama Cloud       | `ollama-cloud`    | `ollama run gpt-oss:120b-cloud`               | `ollama signin` or `OLLAMA_API_KEY` |
| LM Studio Local    | `lm-studio-local` | `lms server status`                           | `lms server status --json --quiet`  |

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
