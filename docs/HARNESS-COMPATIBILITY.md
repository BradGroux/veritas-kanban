# Harness Compatibility

Veritas publishes one reviewed compatibility record for Buzz, Grok Build,
OpenAI Codex app-server, Claude Code, and GitHub Copilot CLI. The canonical
machine-readable form is:

```text
GET /api/config/harness-compatibility
```

Settings -> Agents and `vk doctor --json` consume that record. Run telemetry
stores the same profile capability digest beside the existing support tier,
provider version/build, runtime-manifest digest, and failure class.

## Reviewed matrix

| Harness            | Profile                   | Tested build                                                                        | Transport              | Source availability    | Important limitation                                                                               |
| ------------------ | ------------------------- | ----------------------------------------------------------------------------------- | ---------------------- | ---------------------- | -------------------------------------------------------------------------------------------------- |
| Buzz               | `buzz-agent`              | Buzz v0.4.24, commit `710ed9fff57878a1d69f809b80a6ee0416c53fc4`; `buzz-agent 0.1.0` | ACP v1 stdio           | Open source            | Task execution uses `buzz-agent`; relay, identity, community, and workflow checks remain separate. |
| Grok Build         | `grok-build`              | v0.2.111, build `94172f2aa4e5`                                                      | ACP v1 stdio           | Partial source lineage | The released artifact self-reports alpha and is not fully traceable to the public source tree.     |
| OpenAI Codex       | `openai-codex-app-server` | `codex-cli 0.145.0`                                                                 | app-server JSON-RPC v2 | Open source            | Experimental methods remain excluded until pinned schemas and behavior are reviewed.               |
| Claude Code        | `claude-code`             | `2.1.218 (Claude Code)`                                                             | stream-json process    | Partial source         | The complete CLI implementation is not public; some host enforcement remains provider-dependent.   |
| GitHub Copilot CLI | `github-copilot-cli`      | v1.0.74, commit `2b809c84e87dbcc88f897cb4f3fb97c43b77af95`                          | ACP v1 stdio           | Partial source         | ACP is public preview and provider-managed authentication has no non-consuming status probe.       |

The API is authoritative for the full capability list, reviewed evidence URLs,
fixture paths, platform coverage, limitations, live readiness, and matrix
digest. This table is an operator summary, not a substitute for current probe
evidence.

## Support tiers

| Tier          | Definition                                                                                                           |
| ------------- | -------------------------------------------------------------------------------------------------------------------- |
| `certified`   | Installed build, configuration, runtime manifest, probe revision, and deterministic fixtures match passing evidence. |
| `configured`  | The executable adapter can dispatch, but current deterministic certification evidence is absent.                     |
| `detected`    | The executable is installed, but the profile is disabled.                                                            |
| `degraded`    | A readiness, compatibility, policy, or certification check failed.                                                   |
| `unsupported` | The platform or configured provider has no safe executable adapter for the profile.                                  |

These definitions are emitted in the matrix response. CLI, API, web, and
telemetry must not maintain provider-specific alternatives.

## Certification and invalidation

Each reviewed profile includes a deterministic fixture set, fixture revision,
capability digest, evidence paths, and current status. Certification is
invalidated by any change to:

- provider version or build;
- profile configuration digest;
- runtime probe revision;
- transport protocol version;
- capability digest; or
- fixture revision.

Credential-gated smoke evidence is supplemental only. It can add exact-build
runtime evidence, but it cannot replace or overwrite a deterministic failure.
Raw observations retain launch-manifest, runtime-manifest, task, attempt, and
event references through `harness-conformance-result/v1`.

## Operating each harness

Detailed installation, authentication, configuration, permissions, MCP,
worktree, upgrade, degraded-state, and troubleshooting guidance is maintained
with each provider:

- [Buzz Agent ACP](AGENT-PROVIDERS.md#buzz-agent-acp)
- [Grok Build ACP](AGENT-PROVIDERS.md#grok-build-acp)
- [OpenAI Codex app-server](AGENT-PROVIDERS.md#openai-codex-app-server-v01450)
- [Claude Code](AGENT-PROVIDERS.md#claude-code-v21218)
- [GitHub Copilot CLI ACP](AGENT-PROVIDERS.md#github-copilot-cli-acp-public-preview)

The common operating contract is:

1. Install the exact tested build.
2. Authenticate through the provider's login or an allowlisted boot credential.
3. Enable the built-in profile without adding provider-owned launch bypasses.
4. Assign a Veritas sandbox, permission, and approval policy.
5. Run `vk doctor --json`; fix any degraded or unsupported evidence.
6. Re-run deterministic certification after an upgrade or evidence revision.

Veritas launches all five harnesses in the assigned task worktree. MCP access is
limited to the immutable task catalog plus the system-owned `veritas-run`
bridge. Unsafe launch flags, unexpected versions, stale certification, and
adapter/profile mismatches fail closed before an attempt is created.
