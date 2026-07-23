# Agent Providers

Veritas works as a board without any agent runner. When you do enable agents, provider profiles are configured in **Settings -> Agents** and are stored in the same app config for the web app and the macOS desktop app.

![Agent provider settings](assets/v5/v5-agent-providers.png)

## Defaults

Fresh v5 installs use OpenAI Codex as the default agent:

- `codex` is enabled by default and uses `codex exec --sandbox workspace-write --json`.
- `codex-sdk` and `hermes` have executable adapters but are disabled by default.
- `claude-code`, `amp`, `copilot`, `gemini`, `codex-cloud`, `ollama-local`, `ollama-cloud`, and `lm-studio-local` remain visible for configuration and migration, but they cannot dispatch until a matching executable adapter ships.
- Built-in routing sends code, bug, documentation, and review work to `codex` first, with conservative fallbacks for higher-risk code paths.

Existing configs keep the user's chosen default agent. Missing built-in profiles are added during config normalization without overwriting customized commands, arguments, or enabled states.

## Harness Support Profiles And Tiers

Every configured agent is normalized to a `harness-support-profile/v1` contract.
The profile records stable profile and adapter IDs, transport, executable and
non-mutating authentication probes, version/build invalidation policy,
platforms, launch/worktree behavior, environment and credential allowlists,
conformance fixture identity, documentation, and remediation. The contract
contains credential key names only, never credential values. Credential-like
launch arguments are replaced with `[REDACTED]` before the profile is exposed
or hashed, so rotating a secret cannot turn the profile digest into a secret
oracle.

The live status projection uses five tiers:

| Tier          | Meaning                                                                                                                      |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `detected`    | The executable is installed, but the profile is disabled or not ready for dispatch.                                          |
| `configured`  | The explicit adapter is enabled and its runtime probe is ready, but current certification evidence is absent.                |
| `certified`   | The installed version, build, manifest digest, and probe revision match a passing conformance result.                        |
| `degraded`    | The adapter exists, but installation, authentication, probe, compatibility, or certification evidence is unhealthy or stale. |
| `unsupported` | The profile has no executable adapter or does not support the current platform.                                              |

Settings -> Agents displays the same tier returned by
`GET /api/config/agent-support`. `vk doctor` consumes that endpoint unchanged:
an enabled `degraded` or `unsupported` profile is a blocking failure, while an
enabled `configured` profile is a warning until certification is current.
Reasons and remediation are redacted before leaving the server.

Task start rechecks the normalized profile before attempt state is created. An
explicit provider must match the profile's executable adapter. A display-only
Claude Code or Copilot profile, an unsupported provider, or an unknown
provider-less profile fails with an actionable `409` and can never fall through
to OpenClaw. Recognized credential material in the configured command or launch
arguments degrades the profile and blocks dispatch before probing or attempt
creation. Put credentials in an allowlisted environment key or a run-scoped
brokered credential reference instead.

For backward compatibility, normalization migrates only known provider-less
Codex and Hermes records when both the built-in type and command identity match
(`codex` -> `codex-cli`, `hermes` -> `hermes-cli`). New and custom profiles must
set an explicit provider. Command-name inference is not a general
adapter-selection mechanism.

## Provider Runtime Manifests

Before a task attempt mutates task state, the selected execution adapter emits a
`provider-runtime-manifest/v1` snapshot. The snapshot records the adapter and
protocol version, provider build/version evidence, configured models, probe
timestamp and diagnostics, and every known runtime or sandbox capability as
`supported`, `advisory`, `unsupported`, or `unknown`.

Veritas currently has executable task adapters for `codex-cli`, `codex-sdk`,
`hermes-cli`, and `openclaw`. An explicitly configured Claude Code, Copilot,
Codex Cloud, Ollama, LM Studio, or custom profile is not silently sent through
OpenClaw; task dispatch fails with an actionable `409` until that provider has
an execution adapter.

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

One evaluator maps those capabilities to launch and run controls. Agent starts
always require `run.start`, `run.status`, `run.logs`, `run.complete`, and
`workspace.worktrees`; callers can add `requiredRuntimeCapabilities`. Profile
tools, MCP servers, token/cost/tool budgets, workflow sessions, structured
output, and saved artifacts add their own requirements before provider work
starts. `supported` and `advisory` evidence qualify; `unsupported`, `unknown`,
missing, failed-probe, invalid-digest, or mismatched active/persisted evidence
fails closed with concrete remediation.

The task status API returns a `controls` set derived from the persisted launch
snapshot. Stop, message/steer, completion, token reporting, logs, tool events,
and artifact ingestion compare the active and persisted manifest digests before
acting. Task Detail, Work view, and shared co-drive messaging disable actions
that the manifest does not support and show the evaluator's reason.

Agents and supervisors can register the same validated manifest with
`POST /api/agents/register` and refresh it through the heartbeat endpoint. Host
provider, model, `tool.*`, and sandbox posture is derived only from those
manifests. Legacy free-form registration fields remain visible but are not
trusted for runtime requirements. Route and host-preview requests can declare
`requiredRuntimeCapabilities`; `supported` evidence qualifies, `advisory`
evidence qualifies with a warning, and `unsupported`, `unknown`, missing, or
failed-probe evidence rejects the candidate. All requirements must be satisfied
by one manifest, so capabilities are never composed across providers.
Self-registration requires an authenticated agent key/token whose identity
matches the registry agent ID; operators with `agent:write` can register on an
agent's behalf. Unknown request fields and unredacted secret-like evidence are
rejected. Only registrations with a current five-minute heartbeat qualify for
routing. Provider version/build changes invalidate the readiness cache and
force a new conformance probe; active controls continue to use the immutable
snapshot persisted for that attempt.

## Task Envelopes And Commit Policy

Every launch also persists a provider-neutral `task-envelope/v1` snapshot. It
binds the task and attempt identity, objective, background, constraints,
acceptance criteria, worktree identity, launch manifest, expected outputs,
verification gates, evidence requirements, and allowed side effects to one
canonical `sha256:` digest. The worktree baseline records `HEAD` plus every
dirty file that existed before launch, including its staged index blob and
worktree-content SHA-256. Capture retries when HEAD, status, or fingerprints
move and fails closed after three unstable attempts, so later completion
evidence cannot claim pre-existing changes.

Commit behavior is explicit instead of implied by a shared prompt:

- `forbidden` does not authorize a commit.
- `allowed` authorizes a commit but does not require one. This is the compatible
  default for existing tasks.
- `required` requires completion evidence for a commit created after the launch
  baseline.

A one-off `commitPolicy` start value overrides `task.executionPolicy`, which
overrides the legacy `features.agents.autoCommitOnComplete` setting. Legacy
`true` maps to `required`; `false` or an absent value maps to `allowed`.
Requested filesystem, process, commit, and artifact scopes are intersected
with the effective worktree sandbox; ancestor requests such as `/` are clamped
to the assigned worktree and disjoint paths are rejected.
The start response, active status response, task attempt/history, and Markdown
run log expose the same immutable envelope.

### Provider-Owned Transport Rendering

Each executable task adapter renders the provider-neutral envelope into its
own immutable `provider-task-envelope-transport/v1` request. OpenClaw, Codex
CLI, Codex SDK, and Hermes renderers all include the envelope digest, runtime
identity, objective and bounded context, a bounded workspace-baseline summary,
explicit commit policy, allowed side effects, expected outputs, verification
gates, and completion evidence contract. Profile instructions and saved task
checkpoints are rendered as separate, attributed sections and are capped at
20,000 characters each. The persisted task envelope retains the complete
baseline fingerprints used for later attribution.

The callback posture belongs to the adapter:

- OpenClaw receives the attempt-bound Veritas completion callback, including
  the provider-runtime manifest digest.
- Codex CLI returns terminal output through the supervised process.
- Codex SDK returns terminal output through the captured SDK event stream.
- Hermes returns terminal output through scripted process stdout.

Process and stream adapters are explicitly told not to call the Veritas
completion endpoint. None of the renderers claims provider-native structured
output; Veritas owns validation and completion normalization. The exact
rendered request is fingerprinted as `instructions.effective-task-request` in
the run launch manifest, and the provider and adapter must match the envelope
before dispatch.

### Authoritative Completion Results

Every terminal transport is normalized into one immutable
`completion-result/v1`: supervised process exit, SDK stream, OpenClaw callback,
remote-session report, or operator interruption. The result persists on both
the current attempt and attempt history with a canonical digest, a
claim-derived idempotency key, completion timestamp, and terminal source.
Exact duplicate callbacks are safe after persistence or restart. A callback
with different content, attempt identity, or provider-runtime digest returns
`409 Conflict` and cannot replace the first terminal owner.
Callback and remote-session terminal sources are accepted only for OpenClaw.
CLI process and SDK stream providers reject callback transport even when an
attempt ID and manifest digest are known.

Provider summaries, evidence, artifacts, and verification claims are bounded,
redacted, and stored as unverified provider evidence. Veritas independently
captures Git HEAD, post-launch files and commits, task verification state,
local file artifacts, and observable side effects through the replaceable
`CompletionEvidenceSource` port. Unchanged dirty files from the launch
baseline are excluded. The launch baseline records commits already reachable
from other refs, so switching or fast-forwarding to pre-existing history is
not credited to the attempt. Required commits, forbidden commits, missing
verification, missing required outputs, and unauthorized side effects
downgrade a claimed success to recoverable `partial`.

Completion status maps to task state as follows:

- `success` marks the attempt complete and the task done.
- `blocked` marks the attempt failed and the task blocked.
- `failed`, `interrupted`, and `partial` mark the attempt failed and return the
  task to in-progress recovery.

The legacy bounded `{ success, summary, error }` OpenClaw callback remains
accepted and is normalized into the same contract. New callbacks may report
the explicit status, blockers, provider evidence, artifacts, verification
claims, and a continuation handle. Codex CLI, Codex SDK, and Hermes still use
their native harness-owned terminal paths rather than the callback endpoint.
If the server restarts before a harness-owned process or stream attempt
persists a terminal result, startup reconciliation records a digest-bound
`interrupted` result instead of leaving a provider-specific running or failed
record outside this contract. OpenClaw attempts remain recoverable through
their authoritative callback path.

## Effective Run Launch Manifests

Every executable task launch also compiles `run-launch-manifest/v1` before
attempt state is mutated. It references the task envelope instead of copying
its task contract, and records the selected provider/model/transport, redacted
command and arguments, instruction fingerprints and precedence, environment
key names and broker references, profile tools/MCP/permissions/health checks,
sandbox/network posture, readiness and any hashed operator override, budget,
routing/fallback, workspace trust, and the origin of each effective value.
Prompt content, override text, and credential values are never stored in this
manifest.

`POST /api/agents/:taskId/launch-preview` returns the same compiled contract
without creating an attempt or dispatching a process. The CLI equivalent is
`vk launch-preview <task>`. Preview applies the same readiness gate as start.
A profile restriction that the selected adapter
cannot enforce is returned as a concrete blocker, and `start` rejects it before
pending or task attempt state changes. Declaring `tool.calls` support is not
treated as proof that an adapter can enforce a named allowlist.

Current task adapters do not inject a positive named-tool or MCP catalog, so
any non-empty declaration remains a launch blocker. Issue #857 owns the
run-scoped tool-server lifecycle and positive catalog injection; until that
lands, no profile can substitute tool names in prompt prose for enforcement.

Launches can pass `parentAttemptId` to compare replay, resume, or fork inputs.
The comparison ignores attempt IDs, capture/probe timestamps, and other
ephemeral metadata while detecting changes to task policy, provider capability
posture, model, instructions, sandbox, budget, routing, and profile controls.
The manifest, optional parent drift, and governance trace ID are persisted on
the attempt and copied into attempt history. Active run controls compare the
stored launch digest as well as the provider-runtime digest. Completion packet
metadata links both digests, the provider probe revision/version/build, the
governance trace, and parent drift result.

Sandbox launch checks resolve every preset rule through the same manifest.
Settings dry-runs send the digest of the newest matching manifest registered by
a live host; the server resolves that digest rather than trusting a
caller-supplied capability object. A missing, expired, unknown, or
provider-mismatched digest fails closed. Required presets block on unsupported
rules, while advisory presets record warnings and governance evidence.

Workflow agent steps currently execute through the `codex-sdk` and `openclaw`
workflow adapters. A workflow configured with `codex-cli`, `hermes-cli`, or
another provider is rejected before probing or launch instead of validating one
runtime and executing another. The workflow run persists the manifest and
derived controls before provider execution, then gates resume/reattach, tools,
MCP, structured output, token usage, and saved output artifacts from that same
snapshot. Capability evidence is surface-specific: OpenClaw task manifests do
not claim workflow-only follow-up, reattach, or output-artifact behavior, while
workflow manifests use the `openclaw-workflow-session/v1` protocol evidence.
Token telemetry is required only when the effective step budget includes token
or cost limits; runtime-, retry-, or fan-out-only budgets do not require it.

## Sandbox Policy Presets

Use **Settings -> Agents -> Sandbox Policies** to manage reusable filesystem, network, environment, and credential controls for agent execution. Built-in presets are immutable; custom presets can be created, edited, disabled, or deleted.

Presets can be assigned to:

- An agent profile, as the default guardrail for that provider.
- A workflow agent, as the guardrail for that workflow role.
- A one-off agent start request, by passing `sandboxPresetId`.

The launch path dry-runs the selected preset before starting Codex CLI, Codex SDK, or OpenClaw-backed work. Required controls fail closed when the provider cannot support them. Advisory controls continue with warnings and a governance trace. Settings also includes a dry-run panel that shows effective sandbox mode, network access, environment allowlist, unsupported controls, and the trace ID.

Credential references and environment-style `name=value` values are redacted from dry-run output and governance traces. Prefer brokered credential presets for workflows that need scoped secrets instead of exposing broad environment passthrough.

Credential definitions are admin-managed at `/api/credential-broker`. Records
contain only source references, public scope, TTL/use policy, approval posture,
and canonical digests. The broker issues opaque, hashed run leases bound to the
active attempt, immutable launch manifest, and one exact action fingerprint.
Secret values are resolved only inside an internal controlled-dispatch callback;
there is no public API that returns a value or issues a lease to a provider.
Each use or refresh requires a unique operation ID. Only its SHA-256 fingerprint
is persisted, and duplicate operations fail closed rather than replaying
credential-bearing work. Completion, failure, interruption, cancellation, duplicate terminal delivery, startup
reconciliation, and one-minute periodic reconciliation revoke, expire, or
block outstanding leases. Manifest declarations and sandbox broker references
must match definition IDs exactly.

This core does not make an uncontrolled provider process broker-capable.
Required brokered presets treat advisory or externally delegated
`credential.broker` evidence as unsupported and block launch. Provider-facing
handles remain disabled until the provider migration and a controlled egress or
tool boundary are complete. Model-provider boot authentication and explicit
`env-passthrough` compatibility remain separate, high-risk paths and are never
labeled as brokered. See [Credential Broker](CREDENTIAL-BROKER.md).

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

Profile launches pass `profileId` to `/api/agents/:taskId/start`. Veritas resolves the package runtime against the configured provider profile, applies the package model, sandbox preset, and budget policy, renders bounded package instructions in an attributed provider-transport section, and records the profile ID/version in the task attempt plus an `agent_event` activity entry.

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

1. Veritas calls `sessions_spawn` with the OpenClaw-owned task-envelope
   transport, including the callback URL and required `attemptId` plus
   `providerRuntimeManifestDigest` completion provenance.
2. A policy or connection failure rolls the task attempt back to `todo` with an error message.
3. OpenClaw returns a `childSessionKey` which Veritas stores in the attempt record.
4. The OpenClaw sub-session runs autonomously and calls the Veritas callback URL when done.

Late or replayed callbacks are rejected when either provenance value differs
from the active attempt.

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
