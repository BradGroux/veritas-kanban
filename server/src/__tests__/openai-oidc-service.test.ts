import { afterEach, describe, expect, it, vi } from 'vitest';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import {
  OpenAiOidcService,
  consumeOpenAiOidcTransaction,
  isOpenAiOidcConfigured,
  resetOpenAiOidcServiceForTests,
  storeOpenAiOidcTransaction,
} from '../services/openai-oidc-service.js';
import { createTestSqliteDatabase } from '../storage/sqlite/test-helpers.js';
import { SqliteDatabase } from '../storage/sqlite/database.js';
import { SqliteOpenAiOidcTransactionRepository } from '../storage/sqlite/openai-oidc-transaction-repository.js';

const config = {
  enabled: true,
  clientId: 'oaiapp_test',
  redirectUri: 'https://kanban.example.com/api/auth/openai/callback',
};

describe('OpenAiOidcService', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    resetOpenAiOidcServiceForTests();
  });

  it.each(['valid', 'wrong-issuer', 'wrong-audience', 'wrong-nonce', 'expired', 'no-expiration'])(
    'validates signed ID tokens: %s',
    async (scenario) => {
      const { publicKey, privateKey } = await generateKeyPair('ES256');
      const publicJwk = await exportJWK(publicKey);
      const claims = {
        sub: 'acct_signed',
        nonce: scenario === 'wrong-nonce' ? 'other-nonce' : 'expected-nonce',
        iat: Math.floor(Date.now() / 1000),
        ...(scenario === 'no-expiration'
          ? {}
          : { exp: Math.floor(Date.now() / 1000) + (scenario === 'expired' ? -60 : 60) }),
      };
      const idToken = await new SignJWT(claims)
        .setProtectedHeader({ alg: 'ES256', kid: 'test-key' })
        .setIssuer(
          scenario === 'wrong-issuer' ? 'https://other.example' : 'https://auth.openai.com'
        )
        .setAudience(scenario === 'wrong-audience' ? 'another-client' : config.clientId)
        .sign(privateKey);
      const fetchMock = vi.fn().mockImplementation(async (url: string) => {
        if (url.endsWith('openid-configuration')) {
          return Response.json({
            issuer: 'https://auth.openai.com',
            authorization_endpoint: 'https://auth.openai.com/api/accounts/authorize',
            token_endpoint: 'https://auth.openai.com/api/accounts/oauth/token',
            jwks_uri: 'https://auth.openai.com/.well-known/jwks.json',
          });
        }
        if (url.endsWith('jwks.json'))
          return Response.json({ keys: [{ ...publicJwk, kid: 'test-key' }] });
        return Response.json({ id_token: idToken });
      });
      const service = new OpenAiOidcService({ fetch: fetchMock });
      const completion = service.complete(
        'test-code',
        {
          state: 'expected-state',
          nonce: 'expected-nonce',
          codeVerifier: 'test-verifier',
          redirectUri: config.redirectUri,
        },
        config
      );

      if (scenario === 'valid') {
        await expect(completion).resolves.toMatchObject({ subject: 'acct_signed' });
      } else {
        await expect(completion).rejects.toThrow();
      }
    }
  );

  it('keeps PKCE material server-side and consumes it only once', () => {
    const fixture = createTestSqliteDatabase();
    process.env.VERITAS_SQLITE_PATH = fixture.databasePath;
    const transaction = {
      state: 'state',
      nonce: 'nonce',
      codeVerifier: 'verifier',
      redirectUri: config.redirectUri,
    };
    try {
      const id = storeOpenAiOidcTransaction(transaction);

      expect(id).not.toContain('verifier');
      expect(consumeOpenAiOidcTransaction(id)).toEqual(transaction);
      expect(consumeOpenAiOidcTransaction(id)).toBeNull();
    } finally {
      resetOpenAiOidcServiceForTests();
      delete process.env.VERITAS_SQLITE_PATH;
      fixture.cleanup();
    }
  });

  it('atomically consumes a transaction across SQLite connections', () => {
    const fixture = createTestSqliteDatabase();
    fixture.database.open();
    const secondDatabase = new SqliteDatabase({ databasePath: fixture.databasePath });
    secondDatabase.open();
    const first = new SqliteOpenAiOidcTransactionRepository(fixture.database);
    const second = new SqliteOpenAiOidcTransactionRepository(secondDatabase);

    try {
      first.store({ id: 'shared-id', payload: 'sealed-payload', expiresAt: Date.now() + 60_000 });

      expect(second.consume('shared-id')).toBe('sealed-payload');
      expect(first.consume('shared-id')).toBeNull();
    } finally {
      secondDatabase.close();
      fixture.cleanup();
    }
  });

  it('fails closed unless activation configuration is complete and exact', () => {
    expect(isOpenAiOidcConfigured({ enabled: false })).toBe(false);
    expect(isOpenAiOidcConfigured({ enabled: true, clientId: 'oaiapp_test' })).toBe(false);
    expect(
      isOpenAiOidcConfigured({
        ...config,
        redirectUri: 'https://kanban.example.com/another/callback',
      })
    ).toBe(false);
    expect(isOpenAiOidcConfigured(config)).toBe(true);
  });

  it('requests identity scopes with state, nonce, and S256 PKCE but no plan usage scopes', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          issuer: 'https://auth.openai.com',
          authorization_endpoint: 'https://auth.openai.com/api/accounts/authorize',
          token_endpoint: 'https://auth.openai.com/api/accounts/oauth/token',
          jwks_uri: 'https://auth.openai.com/.well-known/jwks.json',
        }),
        { status: 200 }
      )
    );
    const service = new OpenAiOidcService({ fetch: fetchMock });

    const result = await service.begin(config);
    const url = new URL(result.authorizationUrl);

    expect(url.searchParams.get('scope')).toBe('openid profile email');
    expect(url.searchParams.get('scope')).not.toContain('chatgpt.tokens.use.direct');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('state')).toBe(result.transaction.state);
    expect(url.searchParams.get('nonce')).toBe(result.transaction.nonce);
    expect(url.searchParams.get('redirect_uri')).toBe(config.redirectUri);
  });

  it('exchanges the code without logging or returning OAuth credentials', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            issuer: 'https://auth.openai.com',
            authorization_endpoint: 'https://auth.openai.com/api/accounts/authorize',
            token_endpoint: 'https://auth.openai.com/api/accounts/oauth/token',
            jwks_uri: 'https://auth.openai.com/.well-known/jwks.json',
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ id_token: 'signed-id-token', access_token: 'unused-token' }),
          {
            status: 200,
          }
        )
      );
    const verifyIdToken = vi.fn().mockResolvedValue({
      sub: 'acct_123',
      email: 'USER@example.com',
      email_verified: true,
      name: 'Example User',
      picture: 'https://example.com/avatar.png',
    });
    const service = new OpenAiOidcService({ fetch: fetchMock, verifyIdToken });
    const started = await service.begin(config);

    const identity = await service.complete('authorization-code', started.transaction, config);

    expect(identity).toEqual({
      issuer: 'https://auth.openai.com',
      clientId: 'oaiapp_test',
      subject: 'acct_123',
      email: 'user@example.com',
      emailVerified: true,
      displayName: 'Example User',
      avatarUrl: 'https://example.com/avatar.png',
    });
    const tokenRequest = fetchMock.mock.calls[1];
    expect(tokenRequest[1]).toMatchObject({ method: 'POST', redirect: 'error' });
    expect(String(tokenRequest[1]?.body)).toContain('code_verifier=');
    expect(JSON.stringify(identity)).not.toContain('unused-token');
  });
});
