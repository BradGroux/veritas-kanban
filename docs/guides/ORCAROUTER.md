# OrcaRouter with Codex CLI

The optional `orcarouter-codex` agent profile uses Codex CLI **0.155.1** with OrcaRouter's [OpenAI-compatible Responses endpoint](https://docs.orcarouter.ai/native-formats/openai-compat), `https://api.orcarouter.ai/v1`. Existing agents and defaults are unchanged. Other harnesses are unverified for this gateway.

Version 6.3.0 includes this opt-in integration with **live OrcaRouter compatibility unverified**. The pinned CLI passed synthetic-provider checks, but no real gateway task has been accepted or tested. Do not treat a detected executable, a configured environment key, or those synthetic checks as proof that the live gateway accepted a request.

## Configure the profile

Install the pinned CLI and make its `codex` executable available to the Veritas server. Configure `ORCAROUTER_API_KEY` in that server's existing environment-secret mechanism. Do not paste the key into an agent's arguments, model, name, ordinary configuration, or task description. The profile uses the reference `env:ORCAROUTER_API_KEY`; the key value goes only into the selected harness's boot environment. The integration does not save a key or create a new credential store.

In **Settings → Agents**, add an agent using the existing form:

| Field              | Value                                                                                |
| ------------------ | ------------------------------------------------------------------------------------ |
| Name               | A name for this gateway agent                                                        |
| Type Slug          | `orcarouter-codex`                                                                   |
| Command            | `codex`                                                                              |
| Arguments          | `exec`                                                                               |
| Provider           | `codex-cli`                                                                          |
| Model              | An explicitly selected `provider/model` identifier available to your gateway account |
| Sandbox and budget | Your intended existing policies                                                      |

The model is required for this profile, even though the generic form also supports agents with an optional model. For example, `openai/gpt-5` has the required identifier shape; it is not an implicit default or a promise of account availability. The server rejects routing overrides, embedded credentials, automatic-router names and fallback chains in this profile's arguments/model. The endpoint and protocol are system-owned.

An equivalent entry in the existing agents configuration has this shape; retain the other entries and the existing default:

```json
{
  "type": "orcarouter-codex",
  "name": "OrcaRouter",
  "command": "codex",
  "args": ["exec"],
  "enabled": true,
  "provider": "codex-cli",
  "model": "openai/gpt-5"
}
```

Choose this agent explicitly for a managed task. The normal admission, task worktree, sandbox, approval, tool bridge, supervision and budget paths remain in force. Explicit phase support remains limited by the Codex CLI adapter's existing capability evidence. The gateway does not grant permissions that the adapter cannot enforce.

This first profile is for managed task execution. The workflow engine has no Codex CLI execution adapter; referencing `orcarouter-codex` in a workflow fails before runtime probing or dispatch, including when a provider is omitted or changed to the SDK. It must not silently route that profile through another backend.

## Readiness and evidence

The support profile pins the exact CLI version and includes the compiled model-provider configuration in its digest. Changing the model or runtime invalidates the associated evidence. An incompatible build must block the shared launch manifest before an attempt starts. Missing gateway authentication produces an actionable readiness failure; an existing OpenAI login does not authenticate this profile.

Only this gateway profile receives `ORCAROUTER_API_KEY`. Its environment excludes ambient `OPENAI_API_KEY`, `CODEX_API_KEY` and OpenAI endpoint/account overrides. Ordinary Codex profiles do not receive the gateway key, including through the generic extra-environment list. These are provider boot credentials, not task integration credentials; task tools continue using the governed bridge.

The launch manifest records the requested model and endpoint configuration. Normal Codex events supply measured token usage when available. Actual gateway-selected upstream identity and gateway billing cost are unavailable unless exposed through the harness's events; a requested model is not proof of the actual upstream, and absent cost evidence must not be replaced with invented values. Gateway spend controls complement Veritas budgets.

This first profile selects one model and does not configure a fallback chain. Stream reconnection retries are disabled for the custom provider. An interrupted stream must not be advertised as transparent recovery or safe replay of tool side effects. Review a failed task before deciding whether to run it again.

## Live acceptance

The credential-free executable check uses an isolated home/worktree, a synthetic key and an owned localhost server. It covers a successful shell-tool round trip, rejected authentication, rate limiting, an interrupted stream without a repeated request, and cancellation. It requires the pinned CLI but never contacts the real gateway:

```bash
VK_ORCAROUTER_CODEX_COMPATIBILITY=1 pnpm --filter @veritas-kanban/server exec vitest run src/__tests__/orcarouter-codex-compatibility.test.ts
```

A live acceptance run still needs an explicitly configured gateway key, an account-enabled model and operator opt-in. Record the CLI version, requested model, actual model/provider only when reported, measured usage and unavailable cost fields. Exercise a managed task with streamed output, a governed tool call, cancellation, rejected authentication, rate limiting and an interrupted stream. Keep raw provider output and credential values out of committed fixtures and public reports. Mocked transport tests and an executable version check are separate evidence from this live run.

Enabling this profile sends task content to OrcaRouter and the selected upstream provider. Review [OrcaRouter's privacy policy](https://www.orcarouter.ai/privacy.html) and the selected upstream provider's applicable data-handling terms before opting in. No partner-program or revenue-share enrollment is performed by this integration.

## Disable or remove

Disable the agent in Settings before selecting another agent for new tasks. Use the normal run controls for work already in progress; changing configuration is not proof of cancellation. Remove the optional agent when it is no longer needed, then remove its environment credential through the same operator-managed mechanism that supplied it. Existing tasks, artifacts, other agents and defaults remain retained. Any provider-side credential revocation is a separate operator action.
