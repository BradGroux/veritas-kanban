import { describe, expect, it, vi } from 'vitest';
import { verifyEvent } from 'nostr-tools';
import {
  BuzzCompatibilityService,
  buildBuzzCommandEnvironment,
  normalizeBuzzEndpoints,
} from '../services/buzz-compatibility-service.js';

const PUBLIC_KEY = 'ab'.repeat(32);
const SIGNING_KEY = `${'0'.repeat(63)}1`;
const SIGNING_PUBLIC_KEY = '79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798';
const AUTH_TAG = JSON.stringify(['auth', 'cd'.repeat(32), 'kind=9', 'ef'.repeat(64)]);
const BASE_CONFIG = {
  enabled: true,
  relayHttpUrl: 'https://relay.example.test/team',
  expectedCommunity: 'relay.example.test',
  publicKey: PUBLIC_KEY,
  credentialRef: 'env:BUZZ_PRIVATE_KEY',
};

function relayInfo(overrides: Record<string, unknown> = {}) {
  return {
    software: 'https://github.com/block/buzz',
    version: '0.4.24',
    supported_nips: [1, 11, 29, 42, 43],
    supported_extensions: ['nip-er'],
    self: 'cd'.repeat(32),
    limitation: { auth_required: true },
    ...overrides,
  };
}

function response(body: unknown, status = 200): Response {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
}

describe('normalizeBuzzEndpoints', () => {
  it.each([
    [
      'https://relay.example.test',
      undefined,
      'https://relay.example.test',
      'wss://relay.example.test',
      'relay.example.test',
    ],
    [
      'http://127.0.0.1:3000/team/',
      'ws://127.0.0.1:3000/team',
      'http://127.0.0.1:3000/team',
      'ws://127.0.0.1:3000/team',
      '127.0.0.1:3000',
    ],
    [
      'https://[2001:db8::1]:8443/buzz',
      'wss://[2001:db8::1]:8443/buzz',
      'https://[2001:db8::1]:8443/buzz',
      'wss://[2001:db8::1]:8443/buzz',
      '[2001:db8::1]:8443',
    ],
  ])(
    'normalizes %s without losing relay identity',
    (relayHttpUrl, relayWebSocketUrl, httpUrl, webSocketUrl, community) => {
      expect(normalizeBuzzEndpoints({ relayHttpUrl, relayWebSocketUrl })).toMatchObject({
        httpUrl,
        webSocketUrl,
        community,
      });
    }
  );

  it.each([
    {
      relayHttpUrl: 'https://relay.example.test',
      relayWebSocketUrl: 'wss://other.example.test',
    },
    {
      relayHttpUrl: 'https://relay.example.test/a',
      relayWebSocketUrl: 'wss://relay.example.test/b',
    },
    { relayHttpUrl: 'https://user:secret@relay.example.test' },
    { relayHttpUrl: 'ftp://relay.example.test' },
  ])('rejects ambiguous endpoint pairs', (input) => {
    expect(() => normalizeBuzzEndpoints(input)).toThrow();
  });
});

describe('buildBuzzCommandEnvironment', () => {
  it('passes only process-discovery essentials and strips credentials', () => {
    expect(
      buildBuzzCommandEnvironment({
        PATH: '/usr/local/bin:/usr/bin',
        LANG: 'en_US.UTF-8',
        BUZZ_PRIVATE_KEY: 'must-not-pass',
        BUZZ_AUTH_TAG: 'must-not-pass',
        OPENAI_API_KEY: 'must-not-pass',
      })
    ).toEqual({
      PATH: '/usr/local/bin:/usr/bin',
      LANG: 'en_US.UTF-8',
      NO_COLOR: '1',
    });
  });
});

describe('BuzzCompatibilityService', () => {
  it('verifies relay, identity, membership, and read capability without a mutation', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response(relayInfo()))
      .mockResolvedValueOnce(response([]))
      .mockResolvedValueOnce(response([]));
    const service = new BuzzCompatibilityService({
      fetch,
      resolveSecret: async (reference) =>
        reference === 'env:BUZZ_PRIVATE_KEY' ? 'private-secret' : undefined,
      signer: {
        sign: vi.fn().mockResolvedValue({
          authorization: 'Nostr signed-event',
          publicKey: PUBLIC_KEY,
        }),
      },
      runCommand: vi
        .fn()
        .mockRejectedValue(Object.assign(new Error('missing'), { code: 'ENOENT' })),
      now: () => new Date('2026-07-23T18:00:00.000Z'),
    });

    const result = await service.probe(BASE_CONFIG);

    expect(result).toMatchObject({
      status: 'healthy',
      reasonCode: 'ok',
      configuredRelayHttpUrl: 'https://relay.example.test/team',
      resolvedRelayHttpUrl: 'https://relay.example.test/team',
      resolvedRelayWebSocketUrl: 'wss://relay.example.test/team',
      observedCommunity: 'relay.example.test',
      publicKeyFingerprint: expect.stringMatching(/^[a-f0-9]{12}$/),
      checks: {
        relayIdentity: 'verified',
        communityBinding: 'verified',
        configuredIdentity: 'verified',
        authentication: 'verified',
        membership: 'verified',
        channelRead: 'verified',
        messageRead: 'verified',
      },
      contract: {
        software: 'https://github.com/block/buzz',
        version: '0.4.24',
      },
    });
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      'https://relay.example.test/team/query',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify([{ kinds: [39000], limit: 1 }]),
      }),
      expect.any(Object)
    );
    expect(fetch).toHaveBeenNthCalledWith(
      3,
      'https://relay.example.test/team/query',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify([{ kinds: [9], limit: 1 }]),
      }),
      expect.any(Object)
    );
    expect(JSON.stringify(result)).not.toContain('private-secret');
    expect(JSON.stringify(result)).not.toContain('signed-event');
  });

  it('uses the built-in Buzz signer for the authenticated read-only probe', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response(relayInfo()))
      .mockResolvedValueOnce(response([]))
      .mockResolvedValueOnce(response([]));
    const service = new BuzzCompatibilityService({
      fetch,
      resolveSecret: async () => SIGNING_KEY,
      runCommand: vi
        .fn()
        .mockRejectedValue(Object.assign(new Error('missing'), { code: 'ENOENT' })),
    });

    const result = await service.probe({
      ...BASE_CONFIG,
      publicKey: SIGNING_PUBLIC_KEY,
    });

    expect(result).toMatchObject({
      status: 'healthy',
      reasonCode: 'ok',
      checks: {
        configuredIdentity: 'verified',
        authentication: 'verified',
        membership: 'verified',
        channelRead: 'verified',
        messageRead: 'verified',
      },
    });

    const queryCall = fetch.mock.calls[1];
    const authorization = new Headers(queryCall?.[1]?.headers).get('authorization');
    expect(authorization).toMatch(/^Nostr [A-Za-z0-9+/]+=*$/);
    if (!authorization) throw new Error('Expected Buzz NIP-98 authorization');
    const event = JSON.parse(
      Buffer.from(authorization.slice('Nostr '.length), 'base64').toString('utf8')
    );
    expect(verifyEvent(event)).toBe(true);
    expect(event).toMatchObject({
      kind: 27_235,
      pubkey: SIGNING_PUBLIC_KEY,
      content: '',
      tags: expect.arrayContaining([
        ['u', 'https://relay.example.test/team/query'],
        ['method', 'POST'],
        ['payload', expect.stringMatching(/^[a-f0-9]{64}$/)],
        ['nonce', expect.stringMatching(/^[a-f0-9-]{36}$/)],
      ]),
    });
    expect(JSON.stringify(result)).not.toContain(SIGNING_KEY);
    expect(JSON.stringify(queryCall)).not.toContain(SIGNING_KEY);
  });

  it('classifies relay-side authentication rejection without attempting reads', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response(relayInfo()))
      .mockResolvedValueOnce(response({ error: 'invalid_or_expired_auth' }, 401));
    const service = new BuzzCompatibilityService({
      fetch,
      resolveSecret: async () => 'private-secret',
      signer: {
        sign: vi.fn().mockResolvedValue({
          authorization: 'Nostr signed-event',
          publicKey: PUBLIC_KEY,
        }),
      },
      runCommand: vi
        .fn()
        .mockRejectedValue(Object.assign(new Error('missing'), { code: 'ENOENT' })),
    });

    expect(await service.probe(BASE_CONFIG)).toMatchObject({
      status: 'unauthorized',
      reasonCode: 'authentication_rejected',
      checks: {
        authentication: 'failed',
        channelRead: 'unverified',
        messageRead: 'unverified',
      },
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('classifies membership denial independently from authentication', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response(relayInfo()))
      .mockResolvedValueOnce(
        response(
          {
            error: 'relay_membership_required',
            message: 'You must be a relay member',
          },
          403
        )
      );
    const service = new BuzzCompatibilityService({
      fetch,
      resolveSecret: async () => 'private-secret',
      signer: {
        sign: vi.fn().mockResolvedValue({
          authorization: 'Nostr signed-event',
          publicKey: PUBLIC_KEY,
        }),
      },
      runCommand: vi
        .fn()
        .mockRejectedValue(Object.assign(new Error('missing'), { code: 'ENOENT' })),
    });

    expect(await service.probe(BASE_CONFIG)).toMatchObject({
      status: 'not_member',
      reasonCode: 'relay_membership_required',
      checks: {
        relayIdentity: 'verified',
        communityBinding: 'unverified',
        configuredIdentity: 'verified',
        authentication: 'verified',
        membership: 'failed',
      },
    });
  });

  it('preserves a verified channel read when message reads are denied', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response(relayInfo()))
      .mockResolvedValueOnce(response([]))
      .mockResolvedValueOnce(response({ error: 'read_denied' }, 403));
    const service = new BuzzCompatibilityService({
      fetch,
      resolveSecret: async () => 'private-secret',
      signer: {
        sign: vi.fn().mockResolvedValue({
          authorization: 'Nostr signed-event',
          publicKey: PUBLIC_KEY,
        }),
      },
      runCommand: vi
        .fn()
        .mockRejectedValue(Object.assign(new Error('missing'), { code: 'ENOENT' })),
    });

    expect(await service.probe(BASE_CONFIG)).toMatchObject({
      status: 'unauthorized',
      reasonCode: 'read_capability_rejected',
      checks: {
        authentication: 'verified',
        membership: 'verified',
        channelRead: 'verified',
        messageRead: 'failed',
      },
    });
  });

  it('fails before network access when the expected community does not match', async () => {
    const fetch = vi.fn();
    const service = new BuzzCompatibilityService({
      fetch,
      runCommand: vi
        .fn()
        .mockRejectedValue(Object.assign(new Error('missing'), { code: 'ENOENT' })),
    });

    expect(
      await service.probe({
        ...BASE_CONFIG,
        expectedCommunity: 'other.example.test',
      })
    ).toMatchObject({
      status: 'misconfigured',
      reasonCode: 'community_mismatch',
      checks: { communityBinding: 'failed' },
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('validates a referenced NIP-OA auth tag before forwarding it', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response(relayInfo()))
      .mockResolvedValueOnce(response([]))
      .mockResolvedValueOnce(response([]));
    const service = new BuzzCompatibilityService({
      fetch,
      resolveSecret: async (reference) =>
        reference === 'env:BUZZ_AUTH_TAG'
          ? JSON.stringify(JSON.parse(AUTH_TAG), null, 2)
          : 'private-secret',
      signer: {
        sign: vi.fn().mockResolvedValue({
          authorization: 'Nostr signed-event',
          publicKey: PUBLIC_KEY,
        }),
      },
      runCommand: vi
        .fn()
        .mockRejectedValue(Object.assign(new Error('missing'), { code: 'ENOENT' })),
    });

    expect(await service.probe({ ...BASE_CONFIG, authTagRef: 'env:BUZZ_AUTH_TAG' })).toMatchObject({
      status: 'healthy',
      reasonCode: 'ok',
    });
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({ 'x-auth-tag': AUTH_TAG }),
      }),
      expect.any(Object)
    );
    expect(fetch).toHaveBeenNthCalledWith(
      3,
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({ 'x-auth-tag': AUTH_TAG }),
      }),
      expect.any(Object)
    );
  });

  it.each([
    'not-json',
    JSON.stringify(['auth', 'CD'.repeat(32), '', 'ef'.repeat(64)]),
    JSON.stringify(['auth', 'cd'.repeat(32), 'kind=01', 'ef'.repeat(64)]),
    JSON.stringify(['auth', 'cd'.repeat(32), '', 'ef'.repeat(64), 'extra']),
    'x'.repeat(1_025),
  ])('fails closed on an invalid referenced NIP-OA auth tag', async (authTag) => {
    const fetch = vi.fn().mockResolvedValue(response(relayInfo()));
    const service = new BuzzCompatibilityService({
      fetch,
      resolveSecret: async (reference) =>
        reference === 'env:BUZZ_AUTH_TAG' ? authTag : 'private-secret',
      signer: {
        sign: vi.fn().mockResolvedValue({
          authorization: 'Nostr signed-event',
          publicKey: PUBLIC_KEY,
        }),
      },
      runCommand: vi
        .fn()
        .mockRejectedValue(Object.assign(new Error('missing'), { code: 'ENOENT' })),
    });

    const result = await service.probe({ ...BASE_CONFIG, authTagRef: 'env:BUZZ_AUTH_TAG' });
    expect(result).toMatchObject({ status: 'misconfigured', reasonCode: 'auth_tag_invalid' });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(result)).not.toContain(authTag);
  });

  it('distinguishes an invalid query response from invalid relay metadata', async () => {
    const service = new BuzzCompatibilityService({
      fetch: vi
        .fn()
        .mockResolvedValueOnce(response(relayInfo()))
        .mockResolvedValueOnce(response({ unexpected: true })),
      resolveSecret: async () => 'private-secret',
      signer: {
        sign: vi.fn().mockResolvedValue({
          authorization: 'Nostr signed-event',
          publicKey: PUBLIC_KEY,
        }),
      },
      runCommand: vi
        .fn()
        .mockRejectedValue(Object.assign(new Error('missing'), { code: 'ENOENT' })),
    });

    expect(await service.probe(BASE_CONFIG)).toMatchObject({
      status: 'unsupported',
      reasonCode: 'query_response_invalid',
      checks: {
        relayIdentity: 'verified',
        communityBinding: 'verified',
        authentication: 'verified',
        membership: 'verified',
        channelRead: 'unverified',
        messageRead: 'unverified',
      },
    });
  });

  it('fails closed on unsupported builds while retaining safe relay evidence', async () => {
    const service = new BuzzCompatibilityService({
      fetch: vi.fn().mockResolvedValue(response(relayInfo({ version: '0.5.0' }))),
      resolveSecret: async () => 'must-not-be-read',
      runCommand: vi
        .fn()
        .mockRejectedValue(Object.assign(new Error('missing'), { code: 'ENOENT' })),
    });

    expect(await service.probe(BASE_CONFIG)).toMatchObject({
      status: 'unsupported',
      reasonCode: 'relay_version_unsupported',
      contract: { version: '0.5.0' },
      checks: { relayIdentity: 'verified', authentication: 'unverified' },
    });
  });

  it('does not leak secrets from signer or relay errors', async () => {
    const secret = 'nsec1thismustneverappear';
    const service = new BuzzCompatibilityService({
      fetch: vi.fn().mockResolvedValue(response(relayInfo())),
      resolveSecret: async () => secret,
      signer: {
        sign: vi.fn().mockRejectedValue(new Error(`invalid private key ${secret}`)),
      },
      runCommand: vi
        .fn()
        .mockRejectedValue(Object.assign(new Error('missing'), { code: 'ENOENT' })),
    });

    const result = await service.probe(BASE_CONFIG);
    expect(result.status).toBe('unreachable');
    expect(JSON.stringify(result)).not.toContain(secret);
  });

  it('invalidates evidence when identity, reference, command, or contract changes', async () => {
    const probe = async (
      change: Partial<typeof BASE_CONFIG> & { command?: { executable: string } } = {},
      version = '0.4.24',
      observedPublicKey = change.publicKey ?? PUBLIC_KEY
    ) => {
      const service = new BuzzCompatibilityService({
        fetch: vi
          .fn()
          .mockResolvedValueOnce(response(relayInfo({ version })))
          .mockResolvedValueOnce(response([]))
          .mockResolvedValueOnce(response([])),
        resolveSecret: async () => 'private-secret',
        signer: {
          sign: vi.fn().mockResolvedValue({
            authorization: 'Nostr signed-event',
            publicKey: observedPublicKey,
          }),
        },
        runCommand: vi.fn().mockResolvedValue({ stdout: 'buzz 0.4.24', stderr: '' }),
      });
      return service.probe({ ...BASE_CONFIG, ...change });
    };

    const baseline = await probe();
    expect((await probe({ publicKey: 'cd'.repeat(32) })).evidenceKey).not.toBe(
      baseline.evidenceKey
    );
    expect((await probe({ credentialRef: 'env:OTHER_KEY' })).evidenceKey).not.toBe(
      baseline.evidenceKey
    );
    expect((await probe({ command: { executable: '/opt/buzz' } })).evidenceKey).not.toBe(
      baseline.evidenceKey
    );
    expect((await probe({}, '0.5.0')).evidenceKey).not.toBe(baseline.evidenceKey);
    const rotatedIdentity = await probe({}, '0.4.24', 'cd'.repeat(32));
    expect(rotatedIdentity).toMatchObject({
      status: 'misconfigured',
      reasonCode: 'public_key_mismatch',
    });
    expect(rotatedIdentity.evidenceKey).not.toBe(baseline.evidenceKey);
  });

  it('bounds relay response bodies', async () => {
    const service = new BuzzCompatibilityService({
      fetch: vi.fn().mockResolvedValue(response('x'.repeat(65))),
      resolveSecret: async () => 'unused',
      runCommand: vi
        .fn()
        .mockRejectedValue(Object.assign(new Error('missing'), { code: 'ENOENT' })),
      maxResponseBytes: 64,
    });

    expect(await service.probe(BASE_CONFIG)).toMatchObject({
      status: 'unsupported',
      reasonCode: 'response_too_large',
    });
  });

  it('enforces a request timeout without exposing the signing-key reference value', async () => {
    const fetch = vi.fn(
      async (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
          );
        })
    );
    const service = new BuzzCompatibilityService({
      fetch,
      resolveSecret: async () => 'unused',
      runCommand: vi
        .fn()
        .mockRejectedValue(Object.assign(new Error('missing'), { code: 'ENOENT' })),
      timeoutMs: 5,
    });

    const result = await service.probe(BASE_CONFIG);
    expect(result).toMatchObject({
      status: 'unreachable',
      reasonCode: 'relay_unreachable',
    });
    expect(JSON.stringify(result)).not.toContain('unused');
  });

  it('enforces the timeout while a relay response body is stalled', async () => {
    const stalledBody = new ReadableStream<Uint8Array>({
      start() {
        // Intentionally never enqueue or close.
      },
    });
    const service = new BuzzCompatibilityService({
      fetch: vi.fn().mockResolvedValue(
        new Response(stalledBody, {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      ),
      resolveSecret: async () => 'unused',
      runCommand: vi
        .fn()
        .mockRejectedValue(Object.assign(new Error('missing'), { code: 'ENOENT' })),
      timeoutMs: 5,
    });

    expect(await service.probe(BASE_CONFIG)).toMatchObject({
      status: 'unreachable',
      reasonCode: 'relay_unreachable',
    });
  });

  it('does not let the private-network opt-in reach link-local metadata ranges', async () => {
    const service = new BuzzCompatibilityService({
      resolveSecret: async () => 'unused',
      runCommand: vi
        .fn()
        .mockRejectedValue(Object.assign(new Error('missing'), { code: 'ENOENT' })),
    });

    expect(
      await service.probe({
        ...BASE_CONFIG,
        relayHttpUrl: 'http://169.254.170.2',
        expectedCommunity: '169.254.170.2',
        allowPrivateNetwork: true,
      })
    ).toMatchObject({
      status: 'unreachable',
      reasonCode: 'network_policy_blocked',
    });
  });

  it('requires an explicit local or private-network opt-in for plaintext HTTP', async () => {
    const fetch = vi.fn().mockResolvedValue(null);
    const service = new BuzzCompatibilityService({
      fetch,
      resolveSecret: async () => 'unused',
      runCommand: vi
        .fn()
        .mockRejectedValue(Object.assign(new Error('missing'), { code: 'ENOENT' })),
    });

    expect(
      await service.probe({
        ...BASE_CONFIG,
        relayHttpUrl: 'http://relay.example.test',
        expectedCommunity: 'relay.example.test',
      })
    ).toMatchObject({
      status: 'unreachable',
      reasonCode: 'network_policy_blocked',
    });
    expect(fetch).toHaveBeenCalledWith(
      'http://relay.example.test/info',
      expect.any(Object),
      expect.objectContaining({ allowHttp: false })
    );
  });

  it.each([
    ['/opt/buzz/bin/buzz-agent', ['--profile', 'linux']],
    ['/Applications/Buzz.app/Contents/MacOS/Buzz', ['--profile', 'macOS']],
    ['C:\\Program Files\\Buzz\\buzz.exe', ['--profile', 'Local Profile']],
  ])(
    'passes cross-platform executable path %s and argv without a shell',
    async (executable, args) => {
      const runCommand = vi.fn().mockResolvedValue({ stdout: 'buzz 0.4.24', stderr: '' });
      const service = new BuzzCompatibilityService({
        fetch: vi.fn().mockResolvedValue(response(relayInfo({ version: '0.5.0' }))),
        resolveSecret: async () => 'unused',
        runCommand,
      });

      await service.probe({
        ...BASE_CONFIG,
        command: {
          executable,
          args,
        },
      });

      expect(runCommand).toHaveBeenCalledWith(executable, [...args, '--version']);
    }
  );

  it('strips terminal controls from optional command diagnostics', async () => {
    const service = new BuzzCompatibilityService({
      fetch: vi.fn().mockResolvedValue(response(relayInfo({ version: '0.5.0' }))),
      resolveSecret: async () => 'unused',
      runCommand: vi.fn().mockResolvedValue({ stdout: '\u001b[2Jbuzz 0.4.24', stderr: '' }),
    });

    const result = await service.probe(BASE_CONFIG);
    expect(result.commands[0]).toMatchObject({
      available: true,
      version: 'buzz 0.4.24',
    });
    expect(JSON.stringify(result)).not.toContain('\u001b');
  });
});
