import { createHash, randomUUID } from 'node:crypto';
import { finalizeEvent, nip19 } from 'nostr-tools';

const NIP_98_KIND = 27_235;

export interface BuzzNip98Signer {
  sign(input: {
    privateKey: string;
    method: 'POST';
    url: string;
    body: string;
  }): Promise<{ authorization: string; publicKey: string }>;
}

interface NostrToolsBuzzNip98SignerOptions {
  now?: () => number;
  createNonce?: () => string;
}

function invalidPrivateKey(): Error {
  return new Error('Invalid Buzz private key format');
}

function decodePrivateKey(value: string): Uint8Array {
  const candidate = value.trim();
  if (/^[a-fA-F0-9]{64}$/.test(candidate)) {
    return Uint8Array.from(Buffer.from(candidate, 'hex'));
  }
  if (!candidate.startsWith('nsec1')) throw invalidPrivateKey();

  try {
    const decoded = nip19.decode(candidate);
    if (
      decoded.type !== 'nsec' ||
      !(decoded.data instanceof Uint8Array) ||
      decoded.data.byteLength !== 32
    ) {
      throw invalidPrivateKey();
    }
    return decoded.data;
  } catch {
    throw invalidPrivateKey();
  }
}

export class NostrToolsBuzzNip98Signer implements BuzzNip98Signer {
  private readonly now: () => number;
  private readonly createNonce: () => string;

  constructor(options: NostrToolsBuzzNip98SignerOptions = {}) {
    this.now = options.now ?? Date.now;
    this.createNonce = options.createNonce ?? randomUUID;
  }

  async sign(input: {
    privateKey: string;
    method: 'POST';
    url: string;
    body: string;
  }): Promise<{ authorization: string; publicKey: string }> {
    const secretKey = decodePrivateKey(input.privateKey);
    try {
      const event = finalizeEvent(
        {
          kind: NIP_98_KIND,
          created_at: Math.floor(this.now() / 1000),
          tags: [
            ['u', input.url],
            ['method', input.method],
            ['nonce', this.createNonce()],
            ['payload', createHash('sha256').update(input.body, 'utf8').digest('hex')],
          ],
          content: '',
        },
        secretKey
      );
      return {
        authorization: `Nostr ${Buffer.from(JSON.stringify(event), 'utf8').toString('base64')}`,
        publicKey: event.pubkey,
      };
    } catch {
      throw invalidPrivateKey();
    } finally {
      secretKey.fill(0);
    }
  }
}
