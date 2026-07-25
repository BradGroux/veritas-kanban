# Phase Transition Journal

Issue #1035 adds the durable state machine that moves one active run between
compiled phase capability profiles. It builds on the
[Phase Capability Profiles](PHASE-CAPABILITY-PROFILES.md) contract without
duplicating the launch propagation and tool enforcement delivered by #1036 and
#1033.

## Durable record

Each applied change appends one immutable `phase-transition-record/v1` record.
The record binds:

- Workspace, task, active attempt, sequence, and idempotent operation ID
- Prior and effective `phase-capability-evidence/v1` documents
- Added and removed scopes for every changed authority dimension
- Verified actor, reason, and policy decision
- Exact approval or emergency-override evidence when required
- Active `run-launch-manifest/v1` digest
- Deterministic run-event projection reference and timestamp

File storage uses a locked, bounded JSONL journal. SQLite uses an append-only
table with unique run sequence and operation constraints. Both repositories
implement the same compare-and-set contract and recover the current phase as
the highest sequence for the exact workspace, task, and attempt.

## Compare-and-set rules

A request supplies the expected sequence, prior phase-evidence digest, and
launch-manifest digest. The server also verifies that the task still has the
same running attempt, executable provider, and manifest before appending.

The first transition additionally supplies the exact initial compiled
evidence. Later transitions use the journal's current evidence. Stale attempt,
sequence, evidence, manifest, or changed reuse of an operation ID fails closed.
An exact duplicate operation returns the original record without replaying the
transition.

Evidence is validated against its content digest. A blocked result or legacy
identity cannot become the target of an operator transition.

## Policy and approvals

The authority delta is calculated independently for filesystem read and write,
command execution, network egress, credentials, external actions, and the plan
artifact capability.

- Same-authority and narrowing transitions apply immediately.
- Any added scope creates or reuses an exact-action request in the existing run
  approval broker.
- Approval binds the operation, prior and target evidence digests, manifest,
  and complete authority delta.
- Pending approval returns `approval-required`; rejected or expired approval
  fails closed.
- Credential or external-action expansion is classified as critical risk.

An emergency expansion requires verified `admin:manage` authority, a reason,
and an expiry no more than 24 hours in the future. The first read after expiry
appends one system-attributed `override-expired` transition that restores the
prior evidence. Concurrent readers use compare-and-set behavior, so only one
expiry record wins.

## REST controls

Read the active phase and bounded history:

```http
GET /api/agents/:taskId/phase?attemptId=attempt_123&limit=100
```

Request or apply a transition:

```http
POST /api/agents/:taskId/phase/transitions
Content-Type: application/json

{
  "attemptId": "attempt_123",
  "operationId": "move-to-implement",
  "expectedSequence": 1,
  "expectedPhaseEvidenceDigest": "sha256:...",
  "expectedManifestDigest": "sha256:...",
  "reason": "The approved plan is ready to implement.",
  "targetEvidence": {
    "schemaVersion": "phase-capability-evidence/v1"
  }
}
```

The abbreviated `targetEvidence` above represents the complete compiled
evidence document. Reads require `agent:read`; transition requests require
`task:write`. Expansion is not applied until an administrator resolves its
approval. Emergency override authority is checked independently by the service.

## CLI controls

```bash
vk agent:phase TASK-001 --attempt attempt_123 --json

vk agent:transition-phase TASK-001 \
  --attempt attempt_123 \
  --operation move-to-implement \
  --target-evidence ./implement-evidence.json \
  --reason "The approved plan is ready to implement." \
  --json

vk agent:decide-phase-approval runapproval_123 \
  --decision approve \
  --note "Reviewed the exact authority delta." \
  --json
```

For the first transition, add `--from-evidence` and `--manifest`. The CLI reads
the current durable record for later transitions and supplies its sequence,
evidence digest, and manifest automatically. Retry an approved expansion with
the same `--operation` value and the returned `--approval-id`.

Emergency override uses `--override-until` and `--override-reason` together.
The server remains authoritative for administrator permission and maximum
expiry.

## Delivery boundary

The journal makes phase state, approval, expiry, restart recovery, and operator
control durable. Launch propagation binds it into descendants, retries,
continuations, and handoffs. Tool catalogs, mediated invocation, approvals,
completion results, and the run timeline consume the same server-owned active
projection.

The journal still does not prove provider enforcement by itself. ACP stdio
supplies the current pre-execution mediation contract. An adapter without
equivalent command and external-action controls fails an explicit phase launch
closed.
