import { describe, expect, it } from 'vitest';
import { verifyEvent, type VerifiedEvent } from 'nostr-tools';
import { NostrToolsBuzzNip98Signer } from '../services/buzz-nip98-signer.js';

const PRIVATE_KEY_HEX = `${'0'.repeat(63)}1`;
const PRIVATE_KEY_NSEC = 'nsec1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqsmhltgl';
const PUBLIC_KEY_HEX = '79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798';
const QUERY_BODY = '[{"kinds":[39000],"limit":1},{"kinds":[9],"limit":1}]';
const QUERY_BODY_SHA256 = '3cf7aa0af5a4e941e20c0e001869ee85e8c5888566b30c03696c1d52fdbb2355';
const NONCE = '03ef8155-d4c5-4f67-9cb8-bfcf94ed702c';

function decodeAuthorization(value: string): VerifiedEvent {
  expect(value.startsWith('Nostr ')).toBe(true);
  return JSON.parse(Buffer.from(value.slice('Nostr '.length), 'base64').toString('utf8'));
}

function signer(): NostrToolsBuzzNip98Signer {
  return new NostrToolsBuzzNip98Signer({
    now: () => 1_770_000_000_000,
    createNonce: () => NONCE,
  });
}

describe('NostrToolsBuzzNip98Signer', () => {
  it('creates the exact Buzz NIP-98 proof for a hexadecimal private key', async () => {
    const result = await signer().sign({
      privateKey: PRIVATE_KEY_HEX,
      method: 'POST',
      url: 'https://relay.example.test/team/query',
      body: QUERY_BODY,
    });
    const event = decodeAuthorization(result.authorization);

    expect(result.publicKey).toBe(PUBLIC_KEY_HEX);
    expect(event).toMatchObject({
      kind: 27_235,
      created_at: 1_770_000_000,
      content: '',
      pubkey: PUBLIC_KEY_HEX,
      tags: [
        ['u', 'https://relay.example.test/team/query'],
        ['method', 'POST'],
        ['nonce', NONCE],
        ['payload', QUERY_BODY_SHA256],
      ],
    });
    expect(verifyEvent(event)).toBe(true);
  });

  it('accepts the equivalent nsec identity without changing the public contract', async () => {
    const result = await signer().sign({
      privateKey: PRIVATE_KEY_NSEC,
      method: 'POST',
      url: 'https://relay.example.test/query',
      body: '[]',
    });

    expect(result.publicKey).toBe(PUBLIC_KEY_HEX);
    expect(verifyEvent(decodeAuthorization(result.authorization))).toBe(true);
  });

  it.each(['not-a-private-key', '1'.repeat(63), '0'.repeat(64), `nsec1${'secret'.repeat(20)}`])(
    'rejects invalid private material without echoing it',
    async (privateKey) => {
      let error: unknown;
      try {
        await signer().sign({
          privateKey,
          method: 'POST',
          url: 'https://relay.example.test/query',
          body: '[]',
        });
      } catch (caught) {
        error = caught;
      }

      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe('Invalid Buzz private key format');
      expect((error as Error).message).not.toContain(privateKey);
    }
  );
});
