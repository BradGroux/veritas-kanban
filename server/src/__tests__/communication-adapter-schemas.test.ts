import { describe, expect, it } from 'vitest';
import {
  buzzAdapterConfigSchema,
  communicationAdapterConfigSchema,
} from '../schemas/communication-adapter-schemas.js';

describe('communication adapter schemas', () => {
  it('accepts a reference-only Buzz configuration', () => {
    expect(
      buzzAdapterConfigSchema.parse({
        kind: 'buzz',
        relayHttpUrl: 'https://relay.example.test/team',
        relayWebSocketUrl: 'wss://relay.example.test/team',
        expectedCommunity: 'relay.example.test',
        publicKey: 'ab'.repeat(32),
        credentialRef: 'env:BUZZ_PRIVATE_KEY',
        authTagRef: 'env:BUZZ_AUTH_TAG',
        command: {
          executable: 'C:\\Program Files\\Buzz\\buzz.exe',
          args: ['--json'],
        },
      })
    ).toMatchObject({
      kind: 'buzz',
      credentialRef: 'env:BUZZ_PRIVATE_KEY',
    });
  });

  it('accepts explicit nulls to clear optional Buzz configuration', () => {
    expect(
      buzzAdapterConfigSchema.parse({
        kind: 'buzz',
        relayHttpUrl: 'https://relay.example.test',
        publicKey: 'ab'.repeat(32),
        credentialRef: 'env:BUZZ_PRIVATE_KEY',
        relayWebSocketUrl: null,
        expectedCommunity: null,
        authTagRef: null,
        command: null,
      })
    ).toMatchObject({
      relayWebSocketUrl: null,
      expectedCommunity: null,
      authTagRef: null,
      command: null,
    });
  });

  it.each([
    ['raw secret field', { credential: 'secret' }],
    ['URL userinfo', { relayHttpUrl: 'https://user:secret@relay.example.test' }],
    ['URL query', { relayHttpUrl: 'https://relay.example.test?token=secret' }],
    ['ambiguous secret reference', { credentialRef: 'BUZZ_PRIVATE_KEY' }],
    ['invalid public key', { publicKey: 'npub-not-accepted-here' }],
    ['unknown field', { apiTokenRef: 'env:BUZZ_TOKEN' }],
    [
      'credential-bearing command argument',
      { command: { executable: 'buzz', args: ['--private-key', 'nsec1secret'] } },
    ],
    [
      'credential-bearing executable path',
      { command: { executable: '/tmp/nsec1secret/buzz', args: [] } },
    ],
    [
      'bare hexadecimal private key argument',
      { command: { executable: 'buzz', args: ['ab'.repeat(32)] } },
    ],
    [
      'serialized NIP-OA auth tag argument',
      {
        command: {
          executable: 'buzz',
          args: [JSON.stringify(['auth', 'ab'.repeat(32), 'kind=9', 'cd'.repeat(64)])],
        },
      },
    ],
    [
      'shell executable with user-controlled arguments',
      { command: { executable: '/bin/sh', args: ['-c', 'echo unsafe'] } },
    ],
    ['command control characters', { command: { executable: 'buzz\u001b[31m', args: [] } }],
    ['relay URL control characters', { relayHttpUrl: 'https://relay.example.test/\u001b' }],
  ])('rejects %s', (_name, change) => {
    const result = buzzAdapterConfigSchema.safeParse({
      kind: 'buzz',
      relayHttpUrl: 'https://relay.example.test',
      publicKey: 'ab'.repeat(32),
      credentialRef: 'env:BUZZ_PRIVATE_KEY',
      ...change,
    });
    expect(result.success).toBe(false);
  });

  it('keeps the existing Microsoft Teams input compatible', () => {
    expect(
      communicationAdapterConfigSchema.parse({
        displayName: 'Microsoft Teams',
        deliveryMode: 'webhook',
        webhookUrl: 'https://example.test/hook',
        credential: 'write-only-secret',
      })
    ).toMatchObject({
      displayName: 'Microsoft Teams',
      deliveryMode: 'webhook',
    });
  });
});
