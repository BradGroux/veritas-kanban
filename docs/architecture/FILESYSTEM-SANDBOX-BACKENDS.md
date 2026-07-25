# Run-scoped filesystem sandbox backends

This document defines the filesystem enforcement contract for local Veritas
Kanban agent runs. It is the implementation contract for
[issue #862](https://github.com/BradGroux/veritas-kanban/issues/862).

Documentation freshness: 2026-07-25.

## Decision

Veritas compiles every required filesystem policy before attempt state is
mutated. Local process adapters run behind one version-bound sandbox wrapper.
The first supported wrapper is the public `codex sandbox` command introduced
in Codex CLI 0.145:

- macOS uses Seatbelt through `/usr/bin/sandbox-exec`;
- Linux uses the Codex Linux helper with Landlock and bubblewrap where
  available; and
- Windows uses the Codex restricted-token and filesystem capability backend.

Veritas does not shell-wrap providers. It invokes the wrapper with an exact
`SandboxState` JSON document followed by the provider command and arguments.
The wrapper remains the supervised process, so its provider descendants share
the same process group and filesystem boundary.

An unavailable or non-conformant wrapper does not silently weaken a required
policy. A provider-native sandbox can satisfy the contract only when its
versioned runtime manifest reports every required filesystem capability as
supported. The active read, write, deny, dotfile, descendant-process,
run-scoped temporary-directory, and cleanup requirements must all be covered.
Coarse provider modes such as `workspace-write` remain advisory until their
exact-root semantics have version-bound conformance evidence.

Remote providers such as OpenClaw cannot use a host-local wrapper. They must
provide equivalent version-bound native evidence or the required launch is
blocked.

## Compiled policy

The filesystem compiler resolves these preset fields:

| Preset field       | Compiled behavior                                                      |
| ------------------ | ---------------------------------------------------------------------- |
| `readPaths`        | Read-only entries after absolute and symlink-aware resolution          |
| `writePaths`       | Writable entries after absolute and symlink-aware resolution           |
| `deniedPaths`      | Deny entries with precedence over ancestor read or write grants        |
| `dotfileMasking`   | Deny globs for dotfiles below every configured root                    |
| `localOnlyHandles` | Blocks remote execution unless equivalent local-handle evidence exists |

`<workspace>` resolves to the canonical task worktree. `~` resolves to the
operator home directory. Other entries must be absolute. Missing leaf paths
are resolved through their nearest existing canonical ancestor; an
unresolvable or ambiguous path fails closed.

Workspace-relative and home-relative aliases must remain below their
canonical base, so `..` traversal and symlinks cannot turn a scoped grant into
an external grant. Existing mount points below an allowed root are denied
unless that exact mount is explicitly granted or already covered by a deny
rule. Veritas rechecks the relevant mount topology immediately before
activation; a changed or uninspectable topology blocks launch. Provider-native
enforcement blocks on an ambiguous local nested mount because Veritas cannot
amend the provider's native boundary.

Before policy compilation and again immediately before activation, Veritas
scans the bounded workspace tree for pre-existing hard links that alias an
external denied or non-readable inode. It does not follow symlinks during the
scan. An external alias, an unbounded tree, or an inspection failure blocks the
launch instead of relying on the native backend to distinguish two paths to
the same inode.

Required policies start from Codex's `:minimal` platform-runtime read set and
then add only configured roots. The wrapper, provider executable package, and
canonical PATH directories are recorded as read-only `platform-runtime`
entries so the selected harness and normal task tools can execute without
granting a general home-directory read.
Node package roots and Python virtual-environment roots are resolved from the
selected CLI launcher and added narrowly. Linked Git worktrees add only their
canonical worktree and common metadata directories as protected read-only
roots. Ambient system and global Git configuration is disabled inside the
boundary; Veritas carries only the effective author name and email in the
in-memory launch environment when they are available. Those values are not
stored in launch evidence or logs.
The legacy advisory preset retains its documented compatibility behavior and
is recorded as advisory evidence rather than being represented as a required
boundary.

Local provider-native and wrapper-backed runs receive dedicated temporary and
cache directories. They are added as writable roots, supplied through
`TMPDIR`, `TMP`, `TEMP`, and `XDG_CACHE_HOME`, and bound to the durable run
supervisor for terminal cleanup. A remote provider-native backend must instead
prove both run-scoped temporary storage and cleanup ownership in its exact
runtime manifest.

Codex protects `.git`, `.agents`, `.codex`, and `.veritas-kanban` metadata
directly beneath configured writable roots. Veritas records those protected
names in the launch evidence and emits explicit read-only entries so the root
write grant cannot make them writable. A policy cannot select a protected
metadata path itself as a writable root, and a protected path that is or
becomes a symlink blocks activation. Dotfile masking is stronger and denies
reads as well as writes.

## Immutable evidence

`run-launch-manifest/v1` records a
`filesystem-sandbox-evidence/v1` object containing:

- selected backend and operating-system implementation;
- backend version, capability contract version, and executable-content digest;
- the exact provider runtime manifest digest used for the launch decision;
- policy hash;
- read, write, deny, run-temporary, run-cache, and protected-root references;
- hashes of canonical paths instead of private path contents;
- dotfile and descendant-process enforcement state; and
- cleanup ownership by the run supervisor.

The provider runtime manifest remains the evidence authority for
provider-native enforcement. The filesystem evidence links to that manifest
instead of duplicating unredacted provider configuration.

## Conformance and invalidation

The wrapper probe is credential-free. It checks:

1. exact CLI version and required `codex sandbox` flags;
2. allowed reads and writes;
3. denied reads and writes;
4. symlink and hard-link escape resistance;
5. mount-boundary compilation and pre-spawn topology drift;
6. descendant-process inheritance;
7. dotfile masking;
8. protected metadata write denial;
9. PATH tool execution; and
10. re-execution of the selected sandbox backend inside its own boundary.

Probe results are cached only for the current executable byte digest, version,
platform, and Veritas probe revision. Veritas rehashes the selected executable
after policy evaluation and immediately before activation. A replacement,
including a same-size binary with restored timestamps, blocks launch and must
re-run conformance before it can satisfy a required policy.

Platform CI runs deterministic compiler and launch-contract tests everywhere.
Credential-free backend smoke tests run only when the matching native backend
is available.

## Failure and cleanup contract

Policy compilation and backend conformance happen before attempt persistence.
Run directory activation happens after the immutable launch manifest and
supervisor binding exist, but before provider spawn.

If launch fails before supervisor registration, Veritas removes the
task-owned run directory directly. After registration, terminal cleanup is a
durable supervisor responsibility. Cleanup state is persisted so interrupted
or failed removal can be retried without guessing which directory belongs to
the run. Cleanup canonicalizes the sandbox base and rejects a symlinked or
non-directory ancestor before recursive removal.

Veritas exposes no per-run bypass for a required filesystem boundary.
`overrideReason` applies only to task-readiness checks and cannot weaken a
sandbox decision. An operator who intentionally wants advisory enforcement
must use the separately authorized sandbox-policy API to select or maintain an
advisory preset. Policy evaluation and launch then record the resulting
decision in governance evidence linked to the launch manifest.

## Primary sources

- [Codex CLI sandbox command at 0.145.0](https://github.com/openai/codex/blob/25af12f7e61572b0bc18ddb1008be543b91519b0/codex-rs/cli/src/debug_sandbox.rs)
- [Codex permission profile model at 0.145.0](https://github.com/openai/codex/blob/25af12f7e61572b0bc18ddb1008be543b91519b0/codex-rs/protocol/src/models.rs)
- [Codex filesystem policy and protected metadata rules at 0.145.0](https://github.com/openai/codex/blob/25af12f7e61572b0bc18ddb1008be543b91519b0/codex-rs/protocol/src/permissions.rs)
- [Linux Landlock userspace API](https://docs.kernel.org/userspace-api/landlock.html)
- [Bubblewrap sandboxing model](https://github.com/containers/bubblewrap/blob/main/README.md)
- [Windows `CreateRestrictedToken`](https://learn.microsoft.com/en-us/windows/win32/api/securitybaseapi/nf-securitybaseapi-createrestrictedtoken)
- [Windows restricted tokens](https://learn.microsoft.com/en-us/windows/win32/secauthz/restricted-tokens)
