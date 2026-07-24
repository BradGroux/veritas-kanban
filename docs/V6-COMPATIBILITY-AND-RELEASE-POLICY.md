# Veritas Kanban v6 Compatibility And Release Policy

This policy defines supported v6.0.1 combinations, harness evidence, release
channels, and rollback limits. The machine-readable harness record at
`GET /api/config/harness-compatibility` is authoritative for exact capability
digests, fixture revisions, and the current host's live state.

Documentation freshness: 2026-07-24 for Veritas Kanban 6.0.1.

## Harness Support Tiers

| Tier        | Meaning                                                                                                                              | Dispatch consequence                                         |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------ |
| Certified   | Installed version/build, profile, runtime manifest, probe revision, capabilities, and deterministic fixtures match passing evidence. | Allowed when all requested controls are supported.           |
| Configured  | The explicit executable adapter is enabled and ready, but current certification evidence is absent.                                  | Allowed with a warning unless policy requires certification. |
| Detected    | The executable is installed but the built-in profile is disabled.                                                                    | Not selected automatically.                                  |
| Degraded    | Installation, authentication, compatibility, policy, or certification evidence is unhealthy or stale.                                | Enabled profiles block before attempt creation.              |
| Unsupported | No safe executable adapter or current-platform contract exists.                                                                      | Always blocks before attempt creation.                       |

Settings, `vk doctor --json`, API diagnostics, telemetry, and dispatch must use
these same definitions. Provider-name shortcuts and implicit OpenClaw fallback
are incompatible with v6.

## Compatibility Matrix

| Component                              | Supported v6 combination                                                                    | Detection/evidence                                                                                      | Fail-closed boundary                                                                                                            |
| -------------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Server, web, shared, CLI, MCP, desktop | All release packages are exactly 6.0.1.                                                     | Package manifests, `/api/health.version`, `vk --version`, MCP metadata, desktop bundle/update metadata. | Mixed release packages are unsupported for publication.                                                                         |
| Public API                             | REST API remains `v1` at `/api/v1`, with `/api` compatibility aliases where documented.     | `X-API-Version`, OpenAPI/reference docs, CLI/MCP smoke.                                                 | Unknown API versions or incompatible auth fail before mutation.                                                                 |
| Buzz Agent                             | Buzz v0.4.24 commit `710ed9fff57878a1d69f809b80a6ee0416c53fc4`; `buzz-agent 0.1.0`; ACP v1. | Exact initialize identity, capability digest, probe revision, composed Buzz fixtures.                   | Unknown build, `buzz-acp`, resume, HTTP/SSE MCP, or capability drift blocks.                                                    |
| Buzz relay integration                 | Buzz v0.4.24; NIP-11, NIP-29, NIP-42; optional NIP-43 membership.                           | Pinned relay compatibility evidence, signed query/event fixtures, mapping state.                        | Host/TLS drift, unsafe URL, bad signature, identity mismatch, replay, or disabled mapping blocks.                               |
| Grok Build                             | v0.2.111 build `94172f2aa4e5`; generic ACP v1.                                              | Exact version/build and `x.ai` capability handshake.                                                    | Unknown version, approval bypass, leader/plugin/endpoint injection, or unsupported controls blocks.                             |
| Codex CLI                              | Explicit `codex-cli` adapter with exact runtime probe.                                      | `codex --version`, `codex login status`, runtime manifest.                                              | Missing adapter evidence or requested unsupported controls blocks.                                                              |
| Codex SDK                              | `@openai/codex-sdk 0.144.3`.                                                                | SDK import plus Codex authentication and runtime manifest.                                              | Missing SDK/authentication or unsupported controls blocks.                                                                      |
| Codex app-server                       | `codex-cli 0.145.0`, upstream commit `25af12f7e61572b0bc18ddb1008be543b91519b0`.            | Generated v2 schemas, exact version, remote control disabled, deterministic and optional live smoke.    | Schema drift, remote control, inherited plugins/apps/hooks/browser/computer tools, or unsandboxed shell method blocks.          |
| Claude Code                            | `2.1.218 (Claude Code)`.                                                                    | Version, auth status, agent discovery, stream fixtures, optional live smoke.                            | Permission bypass, inherited config/plugins, unsupported lifecycle request, bad stream, or missing authoritative result blocks. |
| GitHub Copilot CLI                     | v1.0.74 public-preview ACP; tag commit `2b809c84e87dbcc88f897cb4f3fb97c43b77af95`.          | Version and ACP initialize handshake; authentication remains provider-managed.                          | Version drift, broad allow, remote/plugin/config injection, or unsupported controls blocks.                                     |
| Hermes Agent                           | v2026.7.7.2 one-shot process adapter.                                                       | `hermes --version` and allowlisted boot authentication.                                                 | Resume/follow-up remains unsupported.                                                                                           |
| OpenClaw                               | v2026.6.11 gateway adapter.                                                                 | Gateway health, runtime manifest, explicit operator tool policy.                                        | Missing `sessions_spawn`/`sessions_send`, unknown evidence, or unsupported task controls blocks.                                |
| macOS desktop                          | macOS arm64 signed/notarized app with bundled 6.0.1 server/web.                             | Bundle version, signature, Gatekeeper, stapling, `/api/health.version`, update metadata.                | Mixed bundle/runtime, failed readiness, signature, or metadata checks blocks stable publication.                                |
| Linux/Windows desktop                  | Unsigned preview artifacts only.                                                            | Cross-platform packaging workflows.                                                                     | Not a supported stable install or update channel.                                                                               |
| Desktop SQLite/profile                 | Existing v5.2.5 workspace upgraded in place after a complete backup.                        | Data/profile counts, integrity check, startup normalization, board/runtime smoke.                       | Competing writers, unsafe filesystem, failed migration, or missing recovery evidence blocks acceptance.                         |

## Certification And Invalidation

Deterministic conformance runs reset a seeded fixture for each repetition and
persist `harness-conformance-result/v1`. Certification is invalidated when the
provider version/build, profile digest, runtime probe revision, transport
version, capability digest, fixture revision, or required policy changes.

Credential-gated live smoke is supplemental. It may prove authentication and
one bounded inference on the exact build, but it cannot override a deterministic
failure. If credentials, subscription, quota, binary, or upstream service are
unavailable, the live tier and evidence must say so.

The credential-free Buzz release gate is:

```bash
pnpm test:buzz:compatibility
```

Provider-specific opt-in smoke commands are documented in
[Agent Providers](AGENT-PROVIDERS.md).

## Security And Authority Boundaries

- Veritas owns tasks, attempts, worktrees, launch manifests, approvals,
  credentials, run tools, causal events, and completion.
- Providers own only their documented transport and native session identifiers.
- Buzz communication owns signed relay delivery, not task completion.
- Credentials enter a provider only through an allowlisted boot-authentication
  key or a run-scoped brokered call. Raw values are never release evidence.
- Required filesystem, process, environment, network, MCP, tool, approval,
  budget, and lifecycle controls must be supported by current runtime evidence.
  Advisory controls may proceed with an attributed warning.
- The fine-grained egress gateway in issue 855 is deferred. v6.0.1 does not
  claim method/path/domain proxy enforcement that it does not have.

## Release Channels

| Channel  | Purpose                                                     | Promotion gate                                                                                                                                                  |
| -------- | ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `dev`    | Local packaged testing and controlled development metadata. | Local build and smoke only; never promoted to users.                                                                                                            |
| `beta`   | Prerelease candidate testing.                               | Full CI, deterministic harness suites, unsigned desktop packaging, migration and runtime smoke, documented blockers.                                            |
| `stable` | Supported macOS arm64 release.                              | Merged release PR, annotated tag, published release, signed/notarized assets, checksums, updater metadata, downloaded-app launch, and live Homebrew validation. |

Linux and Windows preview artifacts do not become stable merely because their
packaging workflows pass.

## Version Negotiation

1. The server, web, CLI, MCP, shared library, and desktop release versions must
   be identical.
2. CLI and MCP write smoke compares the local package version with
   `/api/health.version`. Unreviewed skew is unsupported.
3. A provider upgrade invalidates its old support record even when the provider
   name is unchanged.
4. Desktop local mode uses one bundled server/web payload from the same release
   commit.
5. A stale web/PWA client must refresh before writing. v6 does not queue
   offline API writes.

## Rollback Policy

| Asset                  | Supported rollback                                                                            | Limit                                                                             |
| ---------------------- | --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| macOS app bundle       | Reinstall the previous signed release or correct updater metadata.                            | Safe only when current data/profile records remain compatible with the older app. |
| Bundled server/web     | Roll back with the complete app bundle.                                                       | Never mix payloads from different commits.                                        |
| Self-hosted server     | Install the prior release and restore the pre-upgrade backup when required.                   | No automatic destructive schema down-migration promise.                           |
| Desktop SQLite/profile | Restore the stopped-writer v5.2.5 backup.                                                     | Do not copy over a live database or treat app downgrade as data rollback.         |
| Provider profile       | Disable the changed profile or restore reviewed v5 configuration from backup.                 | Do not re-enable an ambiguous legacy profile or bypass support evidence.          |
| Buzz connection        | Disable trigger rules, mapping, and adapter while retaining audits and local Squad Chat data. | Veritas does not delete remote Buzz events or write imported definitions back.    |

Follow [v6 Upgrade, Install, Remote, And Admin Guide](V6-UPGRADE-INSTALL-ADMIN-GUIDE.md)
and [Migration Recovery](MIGRATION-RECOVERY.md) for the concrete recovery path.
