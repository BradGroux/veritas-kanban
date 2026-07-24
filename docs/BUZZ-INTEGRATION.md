# Buzz Communication Adapter

Veritas Kanban can map a Buzz community channel to Squad Chat and move signed
root messages and replies in both directions. The integration uses Buzz's
native Nostr HTTP and WebSocket contracts. It does not spawn `buzz`,
`buzz-acp`, or `buzz-agent` for delivery.

Buzz is a communication adapter, not an `AgentProvider`. It does not create a
Veritas task, start an ACP agent, synchronize DMs or forums, or read Buzz
Desktop's internal state. An operator may separately materialize selected
public Buzz persona and team definitions as disabled Veritas profiles and
roster members. Definition import is data-only and never starts a process.

Task execution is a separate seam. A disabled-by-default `buzz-agent`
configuration uses provider `acp-stdio` and the generic ACP client. It never
turns relay delivery into task completion and never launches `buzz-acp`.
See [Buzz Agent ACP](AGENT-PROVIDERS.md#buzz-agent-acp).

## Supported contract

The adapter is fixture-pinned to:

- Buzz release `0.4.24`
- Buzz commit `710ed9fff57878a1d69f809b80a6ee0416c53fc4`
- Veritas probe revision `1`
- Relay software identity `https://github.com/block/buzz`
- Required NIPs `11`, `29`, and `42`
- Optional enforced relay membership advertised as NIP `43`

The initial event projection is:

| Buzz surface                          | Veritas behavior                                                           |
| ------------------------------------- | -------------------------------------------------------------------------- |
| Kind `9` root message                 | Creates one Squad Chat message in the mapped target.                       |
| Kind `9` reply                        | Creates one threaded Squad Chat reply using Buzz root/reply tags.          |
| Veritas root                          | Signs and publishes one kind `9` event with the mapped `h` channel tag.    |
| Veritas reply                         | Publishes a direct or nested reply with the exact Buzz root/reply markers. |
| Kind `40003` edit                     | Records bounded audit metadata. Existing Squad Chat text is unchanged.     |
| Kind `9005` or NIP-09 kind `5` delete | Records bounded deletion metadata. Local content is not removed.           |
| Unknown or malformed kind             | Ignores it with a redacted delivery audit entry.                           |
| Reactions, files, canvas, forums, DMs | Not projected.                                                             |

An unknown Buzz version is `unsupported`. Veritas may still read public NIP-11
metadata, but it will not connect the worker or send messages until the pinned
compatibility contract passes.

## Identity and least privilege

Use a dedicated Buzz/Nostr identity. Add that public identity only to the
community and channels that Veritas must bridge. Veritas does not need channel
creation, moderation, desktop storage, or broad community administration.

Keep the private key in the Veritas server environment and store only its
environment-variable reference:

```dotenv
BUZZ_PRIVATE_KEY=<set outside source control>
BUZZ_AUTH_TAG=<optional NIP-OA owner attestation>
```

The signing key may be 64-character private-key hex or `nsec`. It must match
the configured 64-character public-key hex. `BUZZ_AUTH_TAG` is needed only
when an agent identity receives membership through a NIP-OA owner.

Never put an `nsec`, private-key hex, auth tag, token, authorization header, or
raw signed event in a Settings field, API response, task, log, screenshot, or
support packet.

## Configure and map a channel

In **Settings -> Notifications -> Buzz Connection**, configure:

- Relay HTTP URL, such as `https://community.example.com`
- Optional matching WebSocket URL; Veritas derives it when omitted
- Expected community host and optional non-default port
- Buzz channel UUID to map to Squad Chat
- Public-key hex
- `env:BUZZ_PRIVATE_KEY`
- Optional `env:BUZZ_AUTH_TAG`
- Explicit localhost/private-network allowances when required
- Optional `buzz`, `buzz-acp`, or `buzz-agent` executable for version
  diagnostics

HTTP and WebSocket endpoints must have the same host, port, path, and TLS
posture. Credentials, query strings, and fragments are rejected. A configured
path and non-default port are preserved because Buzz binds the community to
the request authority.

The Settings save writes the reference-only adapter first, then writes the
Squad Chat channel mapping. Changing a channel disables the old mapping before
enabling the new one. Conflicting enabled mappings for the same target are
rejected.

## API setup

`settings:write` is required to configure, map, send, reconcile, disable, or
disconnect. `settings:read` can read adapters, mappings, health, and delivery
history.

Configure the connection:

```bash
curl -X PUT http://localhost:3001/api/integrations/communication/adapters/buzz-default \
  -H 'Content-Type: application/json' \
  -H 'X-API-Key: <veritas-api-key>' \
  --data '{
    "kind": "buzz",
    "displayName": "Buzz",
    "enabled": true,
    "relayHttpUrl": "https://community.example.com",
    "expectedCommunity": "community.example.com",
    "publicKey": "<64-hex-public-key>",
    "credentialRef": "env:BUZZ_PRIVATE_KEY",
    "authTagRef": "env:BUZZ_AUTH_TAG"
  }'
```

Map one Buzz channel to Squad Chat:

```bash
CHANNEL_ID=123e4567-e89b-42d3-a456-426614174000

curl -X PUT \
  "http://localhost:3001/api/integrations/communication/adapters/buzz-default/buzz/channels/${CHANNEL_ID}" \
  -H 'Content-Type: application/json' \
  -H 'X-API-Key: <veritas-api-key>' \
  --data '{
    "target": { "kind": "squad" },
    "enabled": true,
    "actor": "operator"
  }'
```

Run the compatibility probe:

```bash
curl \
  http://localhost:3001/api/integrations/communication/adapters/buzz-default/health \
  -H 'X-API-Key: <veritas-api-key>'

vk doctor --json
```

`POST .../buzz-default/test` runs the same read-only probe. It never sends a
message.

## Import persona and team definitions

In **Settings -> Agents -> Buzz Persona and Team Definitions**, an operator can
list, preview, and explicitly import public Buzz definition heads:

- kind `30175` persona definitions keyed by `(author, kind, d tag)`;
- kind `30176` team definitions keyed the same way; and
- the deterministic NIP-33 head with the greatest `created_at`, using the
  lowest event ID to break a tie.

The importer reuses the signed, DNS-pinned Buzz `/query` transport and requires
current healthy compatibility evidence. Every candidate has bounded Nostr
shape, tags, content, JSON depth, arrays, strings, and batch size. Its
signature is reconstructed and verified before it can appear in Settings.
Invalid envelopes contribute only to a rejected count. A signature-valid
current head with rejected content appears as a non-importable coordinate and
field-level validation reason, so Veritas never silently falls back to an older
definition. Unsafe source values are not echoed into the UI or logs.

Preview classifies each field before mutation:

| Buzz definition field                                                                     | Import behavior                                                                    |
| ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Persona `display_name`                                                                    | Source-owned profile display name.                                                 |
| Persona `system_prompt`                                                                   | Source-owned profile prompt when present.                                          |
| Persona `avatar_url`                                                                      | Validated public metadata only. Veritas does not fetch it.                         |
| Persona `runtime`, `model`, `provider`                                                    | Source preferences only, never runtime evidence or active provider configuration.  |
| Persona `name_pool`                                                                       | Bounded source metadata only.                                                      |
| Persona reserved response fields                                                          | Source-only. Veritas does not apply them.                                          |
| Team `name`, `description`                                                                | Source-owned roster fields for create or refresh.                                  |
| Team `persona_ids`                                                                        | Same-author persona slugs resolved to linked profiles and disabled roster members. |
| Unknown fields                                                                            | Ignored with a field-level forward-compatibility explanation.                      |
| Secrets, environment, commands, paths, managed process state, MCP, hooks, skills, engrams | Rejected.                                                                          |

The available actions are:

- `create`: use the deterministic `buzz-<slug>` profile ID or
  `buzz-team-<slug>` roster ID;
- `link`: attach provenance to an explicitly selected existing profile or
  roster without replacing local fields;
- `refresh`: replace only the saved source-owned fields after a new preview;
  and
- `skip`: record no local mutation.

Create, link, and refresh require collision-free preview. A preview returns an
optimistic local revision and exact source event ID. Import rejects a changed
local target or replaced source, so the operator must review the current diff
instead of overwriting concurrent edits. Native profile/roster fields remain
authoritative; refresh preserves local-only fields and existing routing rules.

New persona profiles, new rosters, and imported roster members are disabled.
Import never launches, enables, routes, installs, fetches, or writes back to
Buzz. Removing or replacing a Buzz definition changes its linked-source status
to `missing` or `changed`; it does not delete the materialized local object.

Definition API:

```text
GET  /api/integrations/communication/adapters/:adapterId/buzz/definitions
GET  /api/integrations/communication/adapters/:adapterId/buzz/definitions/links
POST /api/integrations/communication/adapters/:adapterId/buzz/definitions/preview
POST /api/integrations/communication/adapters/:adapterId/buzz/definitions/import
```

Reads and preview require `settings:read`. Import requires `settings:write`.
There is no continuous synchronization and no Buzz write-back endpoint.

## Send roots and replies

Send a root and associate it with a local Squad Chat message:

```bash
curl -X POST \
  http://localhost:3001/api/integrations/communication/adapters/buzz-default/send \
  -H 'Content-Type: application/json' \
  -H 'X-API-Key: <veritas-api-key>' \
  --data '{
    "target": {
      "kind": "squad",
      "squadMessageId": "msg_local_root"
    },
    "message": "Root message from Veritas",
    "actor": "VERITAS"
  }'
```

Send a reply by identifying both the new local message and the local parent:

```bash
curl -X POST \
  http://localhost:3001/api/integrations/communication/adapters/buzz-default/send \
  -H 'Content-Type: application/json' \
  -H 'X-API-Key: <veritas-api-key>' \
  --data '{
    "target": {
      "kind": "squad",
      "squadMessageId": "msg_local_reply"
    },
    "replyToSquadMessageId": "msg_local_root",
    "message": "Reply from Veritas",
    "actor": "VERITAS"
  }'
```

The parent must already have a durable Buzz event mapping. A missing parent is
blocked instead of publishing a detached root.

Each outbound event includes the mapped `h` tag, a `client=veritas-kanban`
marker, and a stable `veritas-id` delivery marker. Veritas persists the signed
event and event ID before submitting it to `/events`.

## Inbound subscription and replay

One supervised WebSocket worker runs per enabled, compatible Buzz connection.
It:

1. resolves and pins the configured relay address through the outbound network
   policy;
2. answers the NIP-42 challenge with kind `22242` and the optional NIP-OA auth
   tag;
3. subscribes only to enabled mapped channel UUIDs and kinds `9`, `40003`,
   `9005`, and `5`;
4. resumes from the persisted cursor with a five-second overlap;
5. verifies each Nostr event signature, channel, kind, timestamp, and size;
6. projects and audits the Squad Chat message; and
7. commits the total-order cursor `(created_at, event_id)` only after the
   projection and audit are durable.

Deduplication uses `(community, event_id)`, never timestamp alone. Squad Chat
uses the deterministic local ID `msg_buzz_<event-id>`, so a crash after the
chat write but before adapter-state persistence replays safely. The original
Buzz author public key, source timestamp, event kind, channel, community,
event ID, and `buzz://message` link remain attached as external metadata.

An out-of-order reply is persisted but does not advance the cursor past its
missing root. When the root arrives, queued replies are replayed in
`(created_at, event_id)` order. A root that never arrives remains bounded
pending state rather than becoming a detached Squad Chat message.

Adapter-originated event IDs are retained and ignored when echoed by the
subscription, preventing a reply loop.

## Ambiguous delivery recovery

Network failure after a write can leave delivery status unknown. Veritas does
not blindly retry:

1. the delivery remains visible as `delivery_unknown`;
2. `POST .../buzz-default/poll` queries `/query` by the signed event ID;
3. if the event exists, the original delivery becomes `success`;
4. if the relay definitively reports absence, Veritas resubmits the exact
   persisted signed event; and
5. if the query is inconclusive, the delivery remains unresolved.

Before query or resubmission, the persisted event is re-verified against its
signature, configured public identity, mapped community/channel, and event ID.
A corrupted record is failed and never retried.

## Health and audit

Health separates:

- compatibility and authorization checks;
- relay transport connection;
- active subscription state;
- mapped-channel count;
- reconnect attempts and last connection;
- last inbound event;
- cursor lag;
- last send time and status; and
- the latest redacted worker error.

Compatibility can be healthy while runtime status is `degraded`, such as when
no channel is mapped or the subscription is still connecting. `canSend`
requires an enabled adapter, current healthy compatibility evidence, and at
least one mapped channel. `canReceiveReplies` additionally requires an active
subscription.

Delivery history exposes `queued`, `success`, `delivery_unknown`, `replayed`,
`ignored`, `failed`, `blocked`, and `skipped`. It retains bounded coordinates
and redacted details, not credentials or raw authorization material.

## Network policy

Public HTTPS/WSS is the default. Plain HTTP/WS requires an explicit localhost
or private-network allowance. Localhost and RFC1918/IPv6 ULA ranges are denied
unless their matching setting is enabled. Link-local, cloud metadata, and
CGNAT ranges remain blocked. DNS is resolved and pinned, redirects are
disabled, payloads are bounded, and requests have fixed timeouts.

Enable only the narrow network class required by the relay.

## Disable, upgrade, and rollback

Disabling a channel mapping closes and rebuilds the worker without deleting
the mapping, cursor, event coordinates, or delivery audit. Disconnecting the
adapter closes the worker and disables delivery while retaining reference-only
configuration and recovery state.

Remove environment secrets separately only when retiring the identity.
Veritas never removes relay membership, changes a Buzz community, or modifies
Buzz Desktop state.

After a Buzz upgrade, run `vk doctor --json`. A version/build change
invalidates prior compatibility evidence and must pass the pinned contract
before workers or sends resume.
