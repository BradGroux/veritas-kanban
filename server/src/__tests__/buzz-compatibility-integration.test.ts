import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BuzzCompatibilityService } from '../services/buzz-compatibility-service.js';
import { CommunicationAdapterService } from '../services/communication-adapter-service.js';

const PUBLIC_KEY = 'ab'.repeat(32);
const FIXTURE_PRIVATE_MATERIAL = 'fixture-private-material';
let closeServer: (() => Promise<void>) | undefined;
let temporaryDirectory: string | undefined;

afterEach(async () => {
  await closeServer?.();
  closeServer = undefined;
  if (temporaryDirectory) {
    await fs.rm(temporaryDirectory, { recursive: true, force: true });
    temporaryDirectory = undefined;
  }
});

function sendJson(response: ServerResponse, body: unknown): void {
  response.statusCode = 200;
  response.setHeader('content-type', 'application/json');
  response.end(JSON.stringify(body));
}

describe('Buzz compatibility fake relay', () => {
  it('proves the authenticated read path without persisting or returning secret material', async () => {
    const requests: Array<{
      method?: string;
      url?: string;
      authorizationPresent: boolean;
    }> = [];
    const server = createServer((request: IncomingMessage, response: ServerResponse) => {
      requests.push({
        method: request.method,
        url: request.url,
        authorizationPresent: Boolean(request.headers.authorization),
      });
      if (request.url === '/info') {
        sendJson(response, {
          software: 'https://github.com/block/buzz',
          version: '0.4.24',
          supported_nips: [1, 11, 29, 42, 43],
          supported_extensions: ['nip-er'],
          self: 'cd'.repeat(32),
          limitation: { auth_required: true },
        });
        return;
      }
      if (request.url === '/query' && request.method === 'POST') {
        sendJson(response, []);
        return;
      }
      response.statusCode = 404;
      response.end();
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    closeServer = () => new Promise<void>((resolve) => server.close(() => resolve()));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('fixture relay did not bind');

    const compatibility = new BuzzCompatibilityService({
      resolveSecret: async () => FIXTURE_PRIVATE_MATERIAL,
      signer: {
        async sign() {
          return { authorization: 'Nostr fixture-signature', publicKey: PUBLIC_KEY };
        },
      },
      runCommand: async () => {
        throw Object.assign(new Error('not installed'), { code: 'ENOENT' });
      },
    });
    temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'buzz-compatibility-'));
    const audit = vi.fn().mockResolvedValue(undefined);
    const adapters = new CommunicationAdapterService({
      storageDir: temporaryDirectory,
      persist: true,
      buzzCompatibility: compatibility,
      audit,
    });
    await adapters.configureAdapter('buzz-default', {
      kind: 'buzz',
      enabled: true,
      relayHttpUrl: `http://127.0.0.1:${address.port}`,
      expectedCommunity: `127.0.0.1:${address.port}`,
      publicKey: PUBLIC_KEY,
      credentialRef: 'env:BUZZ_PRIVATE_KEY',
      allowLocalhost: true,
    });
    const result = await adapters.checkHealth('buzz-default');
    const publicAdapter = await adapters.getAdapter('buzz-default');
    const persisted = await fs.readFile(path.join(temporaryDirectory, 'state.json'), 'utf8');

    expect(result).toMatchObject({
      status: 'healthy',
      reasonCode: 'ok',
      canSend: false,
      canReceiveReplies: false,
    });
    expect(result.buzz).toMatchObject({
      checks: {
        relayIdentity: 'verified',
        communityBinding: 'verified',
        configuredIdentity: 'verified',
        authentication: 'verified',
        membership: 'verified',
        channelRead: 'verified',
        messageRead: 'verified',
      },
    });
    expect(requests).toEqual([
      { method: 'GET', url: '/info', authorizationPresent: false },
      { method: 'POST', url: '/query', authorizationPresent: true },
      { method: 'POST', url: '/query', authorizationPresent: true },
    ]);
    const artifacts = JSON.stringify({
      result,
      publicAdapter,
      persisted,
      audit: audit.mock.calls,
      requests,
    });
    expect(artifacts).not.toContain(FIXTURE_PRIVATE_MATERIAL);
    expect(artifacts).not.toContain('fixture-signature');
    expect(publicAdapter).toMatchObject({
      credentialRef: 'env:BUZZ_PRIVATE_KEY',
      hasCredential: true,
    });
  });
});
