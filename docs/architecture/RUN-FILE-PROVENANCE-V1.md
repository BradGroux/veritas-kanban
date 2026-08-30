# Run File Provenance v1

`run-file-provenance/v1` records where run-produced bytes came from without treating a mutable filename as evidence. Records live in the existing append-only `run-event/v1` journal, so file and SQLite storage use the same causal ordering, idempotency, restart replay, redaction, and retention boundary.

## Record boundary

Every record binds the authenticated workspace, task, root objective, execution-tree node, run, attempt, optional workflow step, causal event ID and sequence, producing tool or command identifiers, normalized root-relative path, SHA-256 digest, byte size, media classification, operation, predecessor, and capture time. Supported roots are `worktree` and `run-artifact`; absolute host paths are never persisted or returned.

Source classes distinguish repository baseline, agent, command, tool, attachment, connector, download, operator, and unknown origins. Safe connector targets and HTTP(S) source URLs may be retained after credentials, query strings, fragments, sensitive keys, and host paths are removed.

Create, modify, replace, rename, copy, extract, and download operations form an immutable predecessor chain. Rename, copy, and extract require an explicit prior path. NFC normalization and case-folded identity detect ambiguous Unicode or case-only collisions. Symlinks, hard links, and other uncertified identities fail closed.

## Journal projection

Successful captures append `file.provenance`; unsupported or invalid captures append `file.provenance-gap`. Both are known run-event kinds. Stable dedupe keys make replay idempotent, while the producing event and exact sequence prevent detached evidence from being recorded as causal.

The projector also detects `file.changed` events that have no paired provenance record and returns an `unsupported-provider-path` or `unsupported-tool-path` gap. It never invents an origin for incomplete provider evidence.

## Resolution

A caller supplies the exact workspace, task, attempt, root, relative path, and SHA-256 digest. Resolution returns:

- `exact` when the digest matches the newest record at that path;
- `stale` when the path has newer bytes;
- `unknown` when no record or relevant gap exists; or
- `gap` when capture was unsupported, invalid, ambiguous, or causally incomplete.

Only `exact` is affirmative provenance evidence. The response includes a bounded predecessor chain and typed gaps. `run-file-provenance-approval-evidence/v1` reduces that response to deterministic record, chain, and gap digests so a later approval can bind the exact evidence without persisting mutable UI state.

## Surfaces and limits

The API exposes exact resolution and bounded attempt listing. `vk agent:file-provenance` mirrors exact resolution. The run timeline shows the newest records and gaps without polling beyond the existing live-run refresh path.

The initial automatic producer integration covers governed File Work Product artifact registration. Providers and tools that cannot expose causal digest-bound file operations remain explicitly unsupported. General filesystem interception, certified link identity, and approval-policy enforcement are separate boundaries; they must not be inferred from this ledger.
