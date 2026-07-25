# Phase Capability Profiles

Issue #1034 establishes the provider-neutral authority contract for execution
phases. It defines what a phase may request and how Veritas computes the
effective result. Issue #1035 adds durable active-run transitions and operator
controls; propagation and tool enforcement remain in later #875 slices.

The compiler remains intentionally pure. It does not mutate an active attempt,
persist a transition, filter a tool catalog, or claim that a provider enforced
the result. The separate
[Phase Transition Journal](PHASE-TRANSITION-JOURNAL.md) owns active state
changes and their evidence.

## Contract

The versioned contracts are:

- `phase-capability-profile/v1` for built-in and workspace-defined profiles
- `phase-transition-intent/v1` for a requested move between phase identities
- `phase-capability-evidence/v1` for the compiled result and blockers

The built-in phase names are `explore`, `plan`, `implement`, `verify`, and
`publish`. Launches without a profile compile in explicit `legacy` mode. Legacy
mode preserves the intersection of existing policies and emits a warning; it
does not silently invent a phase.

## Authority dimensions

The compiler keeps these dimensions independent:

| Dimension             | Scope meaning                                       |
| --------------------- | --------------------------------------------------- |
| `filesystem.read`     | Exact logical paths or roots                        |
| `filesystem.write`    | Exact logical paths or roots                        |
| `command.execute`     | Trusted command classes, not arbitrary command text |
| `network.egress`      | Exact destinations or policy-owned destination IDs  |
| `credential.access`   | Credential definition references, never values      |
| `external.action`     | Exact external action classes                       |
| `artifact.plan.write` | The narrow harness-owned plan artifact capability   |

Scopes are exact strings. `*` means that one source does not narrow the
dimension. It cannot be combined with exact scopes. The compiler does not infer
path ancestry, destination patterns, credential aliases, or command safety.

In particular, an `inspect` command class is only a policy identifier for a
trusted, enforceable tool mapping. It does not make arbitrary shell commands
read-only.

## Built-in profiles

| Phase       | General workspace write | Task credentials   | External mutation  | Plan artifact       |
| ----------- | ----------------------- | ------------------ | ------------------ | ------------------- |
| `explore`   | No                      | No                 | No                 | No                  |
| `plan`      | No                      | No                 | No                 | Optional exact path |
| `implement` | Yes                     | Separately bounded | No                 | No                  |
| `verify`    | Yes                     | No                 | No                 | No                  |
| `publish`   | Yes                     | Separately bounded | Separately bounded | No                  |

Profiles are ceilings, not grants by themselves. Agent, sandbox, tool, and
launch policy sources can always narrow them.

## Deterministic intersection

Effective authority is the exact intersection of:

1. Parent authority
2. The selected phase profile
3. Agent profile authority
4. Sandbox capability
5. Tool catalog capability
6. Launch policy

The compiler never unions scopes. A descendant therefore cannot exceed its
parent. Every dimension records requested scopes, effective scopes, and the
sources that narrowed it.

Each non-phase source also reports whether it can enforce every dimension:

- `enforced` allows its exact scopes to participate.
- `unsupported` removes the dimension and creates a typed blocker when the
  profile requires it.
- `unenforceable` also removes the dimension and creates a distinct typed
  blocker when required.

An enforced source with no matching requested scope produces
`required-authority-denied` for a required dimension. Optional authority can be
narrowed away with a warning. Unknown dimensions and malformed source records
are rejected by strict Zod schemas.

## Plan artifact exception

The plan profile may request one plan artifact through:

```json
{
  "exactPath": ".veritas-kanban/plans/task-1034.md",
  "owner": "veritas-kanban",
  "transport": "harness-api"
}
```

The effective evidence binds that exact normalized repository-relative path.
The contract records `shellRedirection: false` and `indirectWrites: false`.
Absolute paths, traversal, backslashes, control characters, and shell syntax
fail closed. The exception never adds `filesystem.write` authority and cannot
be requested by another built-in phase.

Only the harness API may perform this write. A provider shell, hook, MCP tool,
or redirection must not translate the exception into a general filesystem
grant.

## Delivery boundary

The delivered phase control plane now includes:

- Shared types, strict schemas, built-in profiles, and the pure compiler from
  #1034
- Durable transition state, approvals, emergency override expiry, restart
  recovery, REST, and CLI controls from #1035

The remaining tracking-epic slices add launch, descendant, retry, resume, and
handoff propagation in #1036, then tool enforcement, evidence surfaces, and UI
in #1033. Until those slices land, a durable transition is authoritative
Veritas state, not a claim that every provider process or tool has enforced the
new phase.
