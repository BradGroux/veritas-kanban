# Run File Execution Approval v1

`run-file-execution-approval-evidence/v1` binds files referenced by a mediated command to the exact run approval that permits process creation. A filename is never approval evidence by itself.

## Enforced path

The provider-neutral run terminal normalizes direct worktree executables and supported interpreter, loader, configuration, archive, and load-path inputs. Each regular single-link file is resolved beneath the canonical worktree, hashed with SHA-256, and joined to its exact `run-file-provenance/v1` record or launch baseline. Symlinks, hard links, path escape, oversized inputs, provenance races, and ambiguous identities fail closed.

The approval evidence binds workspace, task, root objective, execution node, run, attempt, workflow step, terminal request ID and digest, command ID, cwd-bound relative path, launch manifest, active phase, project policy, content digest, source class, provenance record and evidence digests, and the combined decision digest. The run terminal handle retains the combined evidence digest.

Downloaded, connector-derived, attachment-derived, external, unknown, stale, or gap-backed executable inputs require a critical `human-only` approval. Agents, services, reviewer models, allowlists, retries, fallback, and prior path approvals cannot resolve that request. Agent, command, and tool-created inputs use the immutable task envelope's project policy: `standard-approval`, `human-approval`, or `deny`. External and unknown sources cannot be downgraded by project policy.

After approval, the server reopens and rehashes every reference, re-resolves its provenance or launch baseline, and compares the complete evidence digest immediately before the synchronous spawn call. Changed bytes, source, phase, manifest, request, policy, or causal evidence invalidate the decision. The approval remains revisioned, expiring, interruption-aware, single-use, and exact to one stable request ID.

## Supported and blocked forms

The first enforcement release covers direct worktree executables; Node, Python, POSIX shell, Ruby, Perl, PowerShell, .NET, and Java archive script inputs; Node loaders and config inputs; and `tar` or `unzip` archive inputs when the path is explicit. Inline interpreter code, Python module dispatch, package-script dispatch, environment load paths, provider-native execution without certified command mediation, and MCP tools declaring `x-veritas-file-execution` return typed blockers. Veritas does not heuristically parse arbitrary shell language or claim downstream tool enforcement it cannot prove.

This control is provenance and approval enforcement, not malware scanning, sandboxing, code review, or a claim that approved bytes are safe.
