# Workspace Execution Trust

Veritas treats repository-controlled agent instructions and executable
configuration as an execution boundary. A task worktree is scanned before
launch, the exact inventory is evaluated against an operator decision, and the
result is bound into the immutable run launch manifest.

This prevents a cloned, moved, nested, sibling, or modified repository from
silently inheriting authorization that was granted to different content.

## Launch flow

Every executable task launch follows the same sequence:

1. Resolve the task's registered Git worktree and canonical repository identity.
2. Inventory recognized repository-controlled instructions and executable
   configuration without following configuration symlinks.
3. Evaluate the inventory against the latest operator decision, project maximum,
   and effective launch restrictions.
4. Block untrusted execution before reading repository instructions or creating
   an attempt.
5. Record the redacted identity, exact inventory digest, decision evidence, and
   requested capabilities in `run-launch-manifest/v1`.
6. Rescan immediately before sandbox activation and provider creation. Any
   identity, inventory, or decision drift aborts the launch.

The no-configuration result is provisional. Veritas rescans it for every
launch, so adding an instruction, hook, MCP server, workflow, extension, or
provider configuration cannot inherit the earlier result.

## Workspace identity

`workspace-execution-trust/v1` derives identity from the canonical worktree,
repository root, Git common directory, and credential-redacted remote identity.
The identity survives a symlink alias or directory rename while remaining
distinct for sibling clones and linked worktrees. Changing the remote identity
also changes the trust identity.

Authorization never flows from a parent, child, sibling, or different remote
repository based on path proximity.

## Inventory

The scanner classifies entries as:

- `declarative-only`: project policy that can only narrow trust.
- `model-influencing`: agent instructions, provider instructions, agent
  definitions, and skills.
- `executable`: MCP/tool server configuration, provider overrides, runtime
  hooks, language-server settings, workflows, extension configuration, and
  custom Git hooks.

Recognized sources include root harness instructions; GitHub Copilot
instructions, workflows, and MCP configuration; Claude settings, agents,
commands, skills, hooks, and MCP configuration; Codex configuration, rules, and
skills; Cursor rules; VS Code tasks, settings, extensions, and MCP
configuration; development-container configuration; `.envrc`; and supported
Buzz, Grok Build, and generic agent definition directories.

Each inventory entry stores only its relative path, classification, requested
capabilities, byte length, symlink state, canonical path digest, and content
fingerprint. File contents and local absolute paths are not copied into the
launch manifest.

The scanner fails closed when a recognized file exceeds 2 MiB, the inventory
exceeds 2,000 entries, recursive discovery exceeds its bounded depth, or the
worktree cannot be resolved as a valid Git repository.

## Decisions and effective modes

Operator decisions are append-only and bound to both the workspace identity and
exact inventory digest.

| Mode         | Effect                                                                                                                                                                     |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `trusted`    | Allows the exact reviewed inventory under the normal launch policy.                                                                                                        |
| `restricted` | Denies inventoried executable configuration and allows only an enforced read-only, no-network launch without task credentials, project tool servers, or external mutation. |
| `denied`     | Blocks the workspace until an operator records a later decision.                                                                                                           |
| `revoked`    | Withdraws the latest active authorization without deleting its audit history.                                                                                              |

Executable configuration always requires an explicit decision. Model-only
instructions may run provisionally in restricted mode when every restricted
boundary is enforceable. Expired, revoked, stale, or inventory-mismatched
authorization cannot permit a launch.

Decision creation and revocation require `admin:manage`. Every mutation records
the authenticated actor, reason, exact inventory digest, timestamp, and
superseded decision where applicable.

## Project maximum

A repository may add `.veritas-kanban/workspace-trust.json`:

```json
{
  "schemaVersion": "workspace-trust-policy/v1",
  "maximumTrust": "restricted"
}
```

`maximumTrust` accepts `trusted`, `restricted`, or `denied`. The file can only
narrow an operator decision. An invalid or symlinked project policy is treated
as `denied`.

## Operator workflow

```bash
vk workspace-trust scan TASK-001
vk workspace-trust decide TASK-001 \
  --mode trusted \
  --inventory sha256:... \
  --reason "Reviewed repository execution configuration"
vk launch-preview TASK-001 --json
```

To withdraw an authorization:

```bash
vk workspace-trust revoke TASK-001 \
  --inventory sha256:... \
  --reason "Repository ownership changed"
```

Use `--json` on any workspace-trust command for the complete versioned record.
See [API Reference](../API-REFERENCE.md#workspace-execution-trust) for the REST
surface.
