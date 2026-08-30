# Run Access Summary v1

`run-access-summary/v1` is the read-only projection of the authority Veritas actually recorded for one task attempt. It does not recalculate policy or grant access. It joins the immutable launch manifest, current or historical phase evidence, provider capability manifest, tool catalog, credential broker metadata, and admission reservation into one redacted operator view.

## Read the summary

Use either interface with an identity that has `agent:read`:

```bash
vk agent:access TASK-001 --attempt attempt_123
vk agent:access TASK-001 --attempt attempt_123 --json

curl "$VK_API_URL/api/agents/TASK-001/access?attemptId=attempt_123" \
  -H "Authorization: Bearer $VK_API_KEY"
```

The Task Work view and the selected run in Timeline render the same API response. Active runs refresh the Task Work projection while their authority can still change.

## Contract

The response contains `current` and `history`. `current` is the launch version or the latest phase transition. `history` contains prior immutable versions in newest-first order. Every version includes:

- exact task, run, attempt, provider, host, manifest, and phase identities;
- filesystem scopes and artifact posture without raw local paths;
- network posture and safe destination labels;
- tool allow, deny, and approval decisions from the immutable run catalog;
- brokered integration posture without credentials, environment values, or header values;
- approval counts, budget usage, reservation state, and concurrency policy;
- harness support and enforcement blockers;
- field sources plus source record digests and verification state.

The summary digest excludes `generatedAt`, so regenerating an unchanged authority projection produces the same digest. A phase transition creates a new summary version rather than rewriting the launch version.

## Status and failure behavior

`complete` means all required source records loaded and their identities and digests agree. `incomplete` means evidence is missing or could not be loaded. `blocked` means launch or phase authority is blocked, or authoritative records conflict.

Missing, unsupported, and conflicting records remain visible as typed blockers. Veritas does not infer missing authority, use provider names as a substitute for capability evidence, or expose stored credential material while building the projection.

## Security boundary

The projection emits content digests, safe scope labels, and hostnames. It strips URL paths and query strings, replaces absolute filesystem targets with redacted labels, and never returns secret source values, credential handles, raw environment values, or transport headers. The source records remain authoritative; this endpoint is diagnostic evidence, not an authorization decision point.
