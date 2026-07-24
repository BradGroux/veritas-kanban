# Buzz Connection Diagnostics

Veritas Kanban can register a Buzz relay as a communication adapter and verify
its compatibility without sending a message or changing relay state. This
first integration slice covers connection configuration, relay/community
identity, NIP-98 authentication, relay membership, channel/message read
capability, and optional local command discovery.

Buzz is a communication harness in this integration. It is not an
`AgentProvider`, and Veritas does not start `buzz`, `buzz-acp`, or `buzz-agent`.
Message send, reply subscription, persona import, and composed agent execution
are separate roadmap capabilities.

## Supported contract

The probe is fixture-pinned to:

- Buzz release `0.4.24`
- Buzz commit `710ed9fff57878a1d69f809b80a6ee0416c53fc4`
- Veritas probe revision `1`
- Relay software identity `https://github.com/block/buzz`
- Required NIPs `11`, `29`, and `42`
- Optional enforced relay membership advertised as NIP `43`

An unknown Buzz version is reported as `unsupported`. Veritas still reads
public NIP-11 metadata, but it does not treat that version as safe evidence for
later message delivery.

## Configure the identity

Use a dedicated Buzz/Nostr identity. Keep the private key in the Veritas server
environment and store only its environment-variable reference in Veritas.

```dotenv
BUZZ_PRIVATE_KEY=<set outside source control>
BUZZ_AUTH_TAG=<optional NIP-OA owner attestation>
```

The signing key may be a 64-character hexadecimal private key or its `nsec`
encoding and must match the configured 64-character hexadecimal public key.
Veritas signs the Buzz-specific NIP-98 event with its pinned `nostr-tools`
runtime. `BUZZ_AUTH_TAG` is needed only when an agent identity receives relay
membership through a NIP-OA owner. Never put an `nsec`, private-key hex, auth
tag, token, or authorization header in the Settings form, API body, task, log,
screenshot, or support packet.

In **Settings -> Notifications -> Buzz Connection**, configure:

- Relay HTTP URL, such as `https://community.example.com`
- Optional matching WebSocket URL; Veritas derives it when omitted
- Expected community host and optional non-default port
- Public key hex
- `env:BUZZ_PRIVATE_KEY`
- Optional `env:BUZZ_AUTH_TAG`
- Explicit localhost/private-network allowances when required
- Optional `buzz`, `buzz-acp`, or `buzz-agent` executable for version
  diagnostics

HTTP/WS endpoints must have the same host, port, path, and TLS posture.
Credentials, query strings, and fragments are rejected. Veritas preserves a
configured path and non-default port because Buzz binds the community to the
request host.

## API setup

`settings:write` is required to configure, test, disable, or disconnect an
adapter. `settings:read` is sufficient to read the adapter and health result.

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

The response returns public configuration and reference posture only. It never
resolves or returns an environment value.

Run the read-only probe:

```bash
curl http://localhost:3001/api/integrations/communication/adapters/buzz-default/health \
  -H 'X-API-Key: <veritas-api-key>'

vk doctor --json
```

`POST .../buzz-default/test` runs the same read-only compatibility probe. It
does not use the generic test-send path.

## Probe sequence

The probe:

1. validates and normalizes HTTP/HTTPS and WS/WSS endpoints;
2. fetches bounded NIP-11 metadata from `/info` through the SSRF-protected,
   DNS-pinned outbound client;
3. verifies Buzz software, version, relay public identity, NIPs, and the
   configured/observed community authority;
4. resolves the signing key and optional auth tag only for the active probe;
5. signs a fresh, host-bound NIP-98 `POST /query` request with the required
   URL, method, random nonce, and exact request-body hash tags;
6. performs separately signed, read-only channel metadata and message filters
   so each capability has independent evidence;
7. classifies authentication, relay membership, and read capability
   independently; and
8. probes optional commands with executable-plus-argv process spawning, a
   timeout, bounded output, no shell, and a minimal environment that excludes
   provider and Buzz credentials.

Configured endpoint strings and separately resolved endpoints are retained in
the redacted result. The compatibility evidence key changes when the endpoint,
expected community, configured or observed public identity, secret reference,
auth-tag reference, network allowance, command configuration/version, Buzz
contract, or Veritas probe revision changes. Persisted evidence from an older
probe release, commit, or revision is not restored as current.

## Status and remediation

| Status          | Meaning                                                          |
| --------------- | ---------------------------------------------------------------- |
| `healthy`       | Relay, identity, membership posture, and reads were verified.    |
| `degraded`      | Public contract is usable, but a bounded diagnostic is partial.  |
| `unsupported`   | Relay software, version, or contract is outside tested support.  |
| `unauthorized`  | Identity proof or read authorization was rejected.               |
| `not_member`    | Identity was authenticated but is not a relay member.            |
| `misconfigured` | Endpoints, community, identity, or secret reference disagree.    |
| `unreachable`   | Network policy, DNS, TLS, timeout, or relay availability failed. |
| `disabled`      | Configuration is retained but no probe is run.                   |

Machine-readable `reasonCode` values distinguish endpoint mismatch,
community mismatch, missing credential reference, malformed NIP-OA auth tags,
public-key mismatch, authentication rejection, membership denial,
read-capability denial, rate-limiting, oversized/invalid responses, and
unsupported builds.

The probe never claims send/reply verification. `canSend` and
`canReceiveReplies` remain `false` for this integration slice.

## Local and private relays

Public HTTPS is the default. Plain HTTP requires an explicit localhost or
private-network allowance. Localhost and RFC1918/IPv6 ULA private ranges are
denied unless the operator enables the matching setting. Link-local, cloud
metadata, and CGNAT ranges remain blocked even when private-network access is
enabled. Both allowances are explicit because a Buzz relay URL is an outbound
request target. DNS is still resolved and pinned for every request, redirects
remain disabled, reads are bounded, and the probe has a fixed timeout.

Enable only the narrow network class required by the relay. Do not use a
private-network allowance to reach cloud metadata or unrelated internal
services.

## Upgrade, disable, and rollback

After a Buzz upgrade, run `vk doctor --json`. A version/build change invalidates
the prior evidence and must pass the pinned compatibility fixtures before it is
considered supported.

Use **Disable** or the disconnect endpoint to stop probes. Buzz reference-only
configuration is retained so rollback does not destroy operator setup. Remove
the environment secrets separately if the identity is being retired. Veritas
does not remove relay membership, change communities, or modify Buzz desktop
state.
