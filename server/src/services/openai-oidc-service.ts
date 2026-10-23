import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { createLocalJWKSet, jwtVerify, type JSONWebKeySet, type JWTPayload } from 'jose';
import { getJwtSecret, getValidJwtSecrets } from '../config/security.js';
import { SqliteDatabase } from '../storage/sqlite/database.js';
import { SqliteOpenAiOidcTransactionRepository } from '../storage/sqlite/openai-oidc-transaction-repository.js';

const OPENAI_ISSUER = 'https://auth.openai.com';
const OPENAI_DISCOVERY_URL = `${OPENAI_ISSUER}/.well-known/openid-configuration`;
const IDENTITY_SCOPES = 'openid profile email';
const TRANSACTION_TTL_MS = 10 * 60 * 1000;

export interface OpenAiOidcConfig {
  enabled: boolean;
  clientId?: string;
  clientSecret?: string;
  redirectUri?: string;
}

interface OpenIdConfiguration {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
}

export interface OpenAiOidcTransaction {
  state: string;
  nonce: string;
  codeVerifier: string;
  redirectUri: string;
  linkUserId?: string;
  linkWorkspaceId?: string;
}

export interface OpenAiOidcIdentity {
  issuer: string;
  clientId: string;
  subject: string;
  email: string | null;
  emailVerified: boolean;
  displayName: string;
  avatarUrl: string | null;
}

export interface OpenAiOidcServiceOptions {
  fetch?: typeof fetch;
  verifyIdToken?: (
    idToken: string,
    configuration: OpenIdConfiguration,
    clientId: string,
    nonce: string
  ) => Promise<JWTPayload>;
}

export function getOpenAiOidcConfig(): OpenAiOidcConfig {
  return {
    enabled: process.env.VERITAS_OPENAI_OIDC_ENABLED === 'true',
    clientId: process.env.VERITAS_OPENAI_OIDC_CLIENT_ID?.trim() || undefined,
    clientSecret: process.env.VERITAS_OPENAI_OIDC_CLIENT_SECRET?.trim() || undefined,
    redirectUri: process.env.VERITAS_OPENAI_OIDC_REDIRECT_URI?.trim() || undefined,
  };
}

export function isOpenAiOidcConfigured(config = getOpenAiOidcConfig()): boolean {
  if (!config.enabled || !config.clientId || !config.redirectUri) return false;
  try {
    validateRedirectUri(config.redirectUri);
    return true;
  } catch {
    return false;
  }
}

export class OpenAiOidcService {
  private readonly fetchImpl: typeof fetch;
  private readonly verifyIdTokenImpl: NonNullable<OpenAiOidcServiceOptions['verifyIdToken']>;
  private configuration: OpenIdConfiguration | null = null;
  private jwks: JSONWebKeySet | null = null;

  constructor(options: OpenAiOidcServiceOptions = {}) {
    this.fetchImpl = options.fetch ?? fetch;
    this.verifyIdTokenImpl = options.verifyIdToken ?? this.verifyIdToken.bind(this);
  }

  async begin(config = getOpenAiOidcConfig()): Promise<{
    authorizationUrl: string;
    transaction: OpenAiOidcTransaction;
  }> {
    const complete = requireCompleteConfig(config);
    const configuration = await this.loadConfiguration();
    const state = randomUrlSafeValue();
    const nonce = randomUrlSafeValue();
    const codeVerifier = randomUrlSafeValue(64);
    const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');
    const authorizationUrl = new URL(configuration.authorization_endpoint);
    authorizationUrl.search = new URLSearchParams({
      response_type: 'code',
      client_id: complete.clientId,
      redirect_uri: complete.redirectUri,
      scope: IDENTITY_SCOPES,
      state,
      nonce,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    }).toString();

    return {
      authorizationUrl: authorizationUrl.toString(),
      transaction: { state, nonce, codeVerifier, redirectUri: complete.redirectUri },
    };
  }

  async complete(
    code: string,
    transaction: OpenAiOidcTransaction,
    config = getOpenAiOidcConfig()
  ): Promise<OpenAiOidcIdentity> {
    const complete = requireCompleteConfig(config);
    if (transaction.redirectUri !== complete.redirectUri) {
      throw new Error('OAuth redirect URI changed during sign-in');
    }

    const configuration = await this.loadConfiguration();
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: complete.clientId,
      code,
      code_verifier: transaction.codeVerifier,
      redirect_uri: transaction.redirectUri,
    });
    const headers: Record<string, string> = {
      accept: 'application/json',
      'content-type': 'application/x-www-form-urlencoded',
    };
    if (complete.clientSecret) {
      const encodeFormComponent = (value: string) =>
        new URLSearchParams({ value }).toString().slice('value='.length);
      headers.authorization = `Basic ${Buffer.from(
        `${encodeFormComponent(complete.clientId)}:${encodeFormComponent(complete.clientSecret)}`
      ).toString('base64')}`;
    }

    const response = await this.fetchWithTimeout(configuration.token_endpoint, {
      method: 'POST',
      headers,
      body,
      redirect: 'error',
    });
    if (!response.ok) throw new Error('OpenAI token exchange failed');
    const tokenResponse = (await response.json()) as Record<string, unknown>;
    if (typeof tokenResponse.id_token !== 'string' || !tokenResponse.id_token) {
      throw new Error('OpenAI token response did not include an ID token');
    }

    const claims = await this.verifyIdTokenImpl(
      tokenResponse.id_token,
      configuration,
      complete.clientId,
      transaction.nonce
    );
    if (typeof claims.sub !== 'string' || !claims.sub) {
      throw new Error('OpenAI ID token did not include a subject');
    }

    const email = typeof claims.email === 'string' ? claims.email.trim().toLowerCase() : null;
    return {
      issuer: configuration.issuer,
      clientId: complete.clientId,
      subject: claims.sub,
      email,
      emailVerified: claims.email_verified === true,
      displayName:
        (typeof claims.name === 'string' && claims.name.trim()) || email || 'ChatGPT user',
      avatarUrl: typeof claims.picture === 'string' ? claims.picture : null,
    };
  }

  private async loadConfiguration(): Promise<OpenIdConfiguration> {
    if (this.configuration) return this.configuration;
    const response = await this.fetchWithTimeout(OPENAI_DISCOVERY_URL, { redirect: 'error' });
    if (!response.ok) throw new Error('Unable to load OpenAI identity configuration');
    const value = (await response.json()) as Partial<OpenIdConfiguration>;
    if (
      value.issuer !== OPENAI_ISSUER ||
      !isOpenAiHttpsEndpoint(value.authorization_endpoint) ||
      !isOpenAiHttpsEndpoint(value.token_endpoint) ||
      !isOpenAiHttpsEndpoint(value.jwks_uri)
    ) {
      throw new Error('OpenAI identity configuration was invalid');
    }
    this.configuration = value as OpenIdConfiguration;
    return this.configuration;
  }

  private async verifyIdToken(
    idToken: string,
    configuration: OpenIdConfiguration,
    clientId: string,
    nonce: string
  ): Promise<JWTPayload> {
    const jwks = await this.loadJwks(configuration.jwks_uri);
    const result = await jwtVerify(idToken, createLocalJWKSet(jwks), {
      issuer: configuration.issuer,
      audience: clientId,
      algorithms: ['RS256', 'ES256'],
      requiredClaims: ['sub', 'iat', 'exp', 'nonce'],
    });
    if (result.payload.nonce !== nonce) throw new Error('OpenAI ID token nonce mismatch');
    return result.payload;
  }

  private async loadJwks(jwksUri: string): Promise<JSONWebKeySet> {
    if (this.jwks) return this.jwks;
    const response = await this.fetchWithTimeout(jwksUri, { redirect: 'error' });
    if (!response.ok) throw new Error('Unable to load OpenAI signing keys');
    const value = (await response.json()) as Partial<JSONWebKeySet>;
    if (!Array.isArray(value.keys) || value.keys.length === 0) {
      throw new Error('OpenAI signing keys were invalid');
    }
    this.jwks = value as JSONWebKeySet;
    return this.jwks;
  }

  private async fetchWithTimeout(input: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      return await this.fetchImpl(input, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }
  }
}

let openAiOidcService: OpenAiOidcService | null = null;
let transactionDatabase: SqliteDatabase | null = null;
let transactionRepository: SqliteOpenAiOidcTransactionRepository | null = null;

export function getOpenAiOidcService(): OpenAiOidcService {
  openAiOidcService ??= new OpenAiOidcService();
  return openAiOidcService;
}

export function resetOpenAiOidcServiceForTests(): void {
  openAiOidcService = null;
  transactionDatabase?.close();
  transactionDatabase = null;
  transactionRepository = null;
}

export function storeOpenAiOidcTransaction(transaction: OpenAiOidcTransaction): string {
  const id = randomUrlSafeValue();
  getTransactionRepository().store({
    id,
    payload: sealTransaction(transaction),
    expiresAt: Date.now() + TRANSACTION_TTL_MS,
  });
  return id;
}

export function consumeOpenAiOidcTransaction(id: string): OpenAiOidcTransaction | null {
  const payload = getTransactionRepository().consume(id);
  if (!payload) return null;
  return openTransaction(payload);
}

function getTransactionRepository(): SqliteOpenAiOidcTransactionRepository {
  if (transactionRepository) return transactionRepository;
  transactionDatabase = new SqliteDatabase();
  transactionDatabase.open();
  transactionRepository = new SqliteOpenAiOidcTransactionRepository(transactionDatabase);
  return transactionRepository;
}

function sealTransaction(transaction: OpenAiOidcTransaction): string {
  const initializationVector = randomBytes(12);
  const cipher = createCipheriv(
    'aes-256-gcm',
    transactionKey(getJwtSecret()),
    initializationVector
  );
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(transaction), 'utf8'),
    cipher.final(),
  ]);
  return [
    initializationVector.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
    ciphertext.toString('base64url'),
  ].join('.');
}

function openTransaction(payload: string): OpenAiOidcTransaction | null {
  const parts = payload.split('.');
  if (parts.length !== 3) return null;
  const [initializationVector, authenticationTag, ciphertext] = parts;
  for (const secret of getValidJwtSecrets()) {
    try {
      const decipher = createDecipheriv(
        'aes-256-gcm',
        transactionKey(secret),
        Buffer.from(initializationVector, 'base64url')
      );
      decipher.setAuthTag(Buffer.from(authenticationTag, 'base64url'));
      const plaintext = Buffer.concat([
        decipher.update(Buffer.from(ciphertext, 'base64url')),
        decipher.final(),
      ]).toString('utf8');
      const value = JSON.parse(plaintext) as Partial<OpenAiOidcTransaction>;
      return isOpenAiOidcTransaction(value) ? value : null;
    } catch {
      // Try the next still-valid signing secret during key rotation.
    }
  }
  return null;
}

function transactionKey(secret: string): Buffer {
  return createHash('sha256').update(`veritas-openai-oidc-transaction:${secret}`).digest();
}

function isOpenAiOidcTransaction(
  value: Partial<OpenAiOidcTransaction>
): value is OpenAiOidcTransaction {
  return (
    typeof value.state === 'string' &&
    value.state.length > 0 &&
    typeof value.nonce === 'string' &&
    value.nonce.length > 0 &&
    typeof value.codeVerifier === 'string' &&
    value.codeVerifier.length > 0 &&
    typeof value.redirectUri === 'string' &&
    value.redirectUri.length > 0 &&
    (value.linkUserId === undefined || typeof value.linkUserId === 'string') &&
    (value.linkWorkspaceId === undefined || typeof value.linkWorkspaceId === 'string')
  );
}

function requireCompleteConfig(
  config: OpenAiOidcConfig
): Required<Pick<OpenAiOidcConfig, 'clientId' | 'redirectUri'>> &
  Pick<OpenAiOidcConfig, 'clientSecret'> {
  if (!isOpenAiOidcConfigured(config) || !config.clientId || !config.redirectUri) {
    throw new Error('Sign in with ChatGPT is not configured');
  }
  validateRedirectUri(config.redirectUri);
  return {
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    redirectUri: config.redirectUri,
  };
}

function validateRedirectUri(value: string): void {
  const url = new URL(value);
  const loopback = url.hostname === '127.0.0.1' || url.hostname === 'localhost';
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) || url.hash) {
    throw new Error('OpenAI redirect URI must use HTTPS (or loopback HTTP) and have no fragment');
  }
  if (url.username || url.password || url.pathname !== '/api/auth/openai/callback') {
    throw new Error('OpenAI redirect URI must use the exact Veritas callback path');
  }
}

function isOpenAiHttpsEndpoint(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.origin === OPENAI_ISSUER;
  } catch {
    return false;
  }
}

function randomUrlSafeValue(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}
