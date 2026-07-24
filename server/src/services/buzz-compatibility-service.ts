import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type {
  BuzzCommandConfig,
  BuzzCommandDiagnostic,
  BuzzCompatibilityChecks,
  BuzzCompatibilityReasonCode,
  BuzzCompatibilityResult,
  BuzzCompatibilityStatus,
  BuzzRelayContract,
} from '@veritas-kanban/shared';
import {
  BUZZ_COMPATIBILITY_SCHEMA_VERSION,
  BUZZ_PROBE_REVISION,
  BUZZ_TESTED_COMMIT,
  BUZZ_TESTED_RELEASE,
} from '@veritas-kanban/shared';
import { redactString } from '../lib/redact.js';
import { NostrToolsBuzzNip98Signer, type BuzzNip98Signer } from './buzz-nip98-signer.js';
import { EnvironmentCredentialSecretSource } from './credential-broker-service.js';
import { safeFetch, type UrlValidationOptions } from '../utils/url-validation.js';

const execFileAsync = promisify(execFile);
const BUZZ_REPOSITORY = 'https://github.com/block/buzz';
const DEFAULT_TIMEOUT_MS = 5_000;
const MAX_RESPONSE_BYTES = 256 * 1024;
const MAX_AUTH_TAG_BYTES = 1_024;
const REQUIRED_NIPS = [11, 29, 42];
const COMMAND_ENV_ALLOWLIST = [
  'PATH',
  'Path',
  'PATHEXT',
  'SystemRoot',
  'SYSTEMROOT',
  'WINDIR',
  'COMSPEC',
  'TMPDIR',
  'TEMP',
  'TMP',
  'LANG',
  'LC_ALL',
] as const;

export interface BuzzProbeConfig {
  enabled: boolean;
  relayHttpUrl: string;
  relayWebSocketUrl?: string;
  expectedCommunity?: string;
  publicKey: string;
  credentialRef: string;
  authTagRef?: string;
  allowLocalhost?: boolean;
  allowPrivateNetwork?: boolean;
  command?: BuzzCommandConfig;
}

export interface NormalizedBuzzEndpoints {
  configuredHttpUrl: string;
  configuredWebSocketUrl?: string;
  httpUrl: string;
  webSocketUrl: string;
  community: string;
  expectedCommunity?: string;
}

export interface BuzzCommandRunner {
  (executable: string, args: string[]): Promise<{ stdout: string; stderr: string }>;
}

export function buildBuzzCommandEnvironment(
  environment: NodeJS.ProcessEnv = process.env
): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = { NO_COLOR: '1' };
  for (const key of COMMAND_ENV_ALLOWLIST) {
    const value = environment[key];
    if (typeof value === 'string') result[key] = value;
  }
  return result;
}

interface BuzzCompatibilityServiceOptions {
  fetch?: (
    url: string,
    init?: RequestInit,
    validationOptions?: UrlValidationOptions
  ) => Promise<Response | null>;
  resolveSecret?: (reference: string) => Promise<string | undefined>;
  signer?: BuzzNip98Signer;
  runCommand?: BuzzCommandRunner;
  now?: () => Date;
  timeoutMs?: number;
  maxResponseBytes?: number;
}

class BuzzProbeError extends Error {
  constructor(
    readonly status: BuzzCompatibilityStatus,
    readonly reasonCode: BuzzCompatibilityReasonCode,
    message: string,
    readonly remediation?: string
  ) {
    super(message);
  }
}

function trimTrailingSlash(pathname: string): string {
  if (pathname === '/') return '';
  return pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
}

function normalizedAuthority(url: URL): string {
  let hostname = url.hostname.toLowerCase();
  if (hostname.endsWith('.')) hostname = hostname.slice(0, -1);
  return `${hostname}${url.port ? `:${url.port}` : ''}`;
}

function normalizeCommunity(value: string): string {
  const candidate = value.includes('://') ? value : `https://${value}`;
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new BuzzProbeError(
      'misconfigured',
      'endpoint_invalid',
      'Expected community is not a valid host or URL.',
      'Use the Buzz relay host, with an explicit non-default port when required.'
    );
  }
  if (
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    trimTrailingSlash(parsed.pathname)
  ) {
    throw new BuzzProbeError(
      'misconfigured',
      'endpoint_invalid',
      'Expected community must identify only a host and optional port.',
      'Remove credentials, path, query, and fragment components.'
    );
  }
  return normalizedAuthority(parsed);
}

function parseRelayUrl(value: string, label: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new BuzzProbeError(
      'misconfigured',
      'endpoint_invalid',
      `${label} is not a valid URL.`,
      'Use an http, https, ws, or wss Buzz relay URL.'
    );
  }

  if (
    !['http:', 'https:', 'ws:', 'wss:'].includes(parsed.protocol) ||
    !parsed.hostname ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  ) {
    throw new BuzzProbeError(
      'misconfigured',
      'endpoint_invalid',
      `${label} contains an unsupported or ambiguous component.`,
      'Use an http, https, ws, or wss URL without credentials, query, or fragment.'
    );
  }
  parsed.pathname = trimTrailingSlash(parsed.pathname);
  return parsed;
}

function baseUrl(url: URL): string {
  return `${url.protocol}//${url.host}${trimTrailingSlash(url.pathname)}`;
}

function withProtocol(url: URL, protocol: 'http:' | 'https:' | 'ws:' | 'wss:'): URL {
  const copy = new URL(url.toString());
  copy.protocol = protocol;
  return copy;
}

function httpProtocol(protocol: string): 'http:' | 'https:' {
  return protocol === 'https:' || protocol === 'wss:' ? 'https:' : 'http:';
}

function webSocketProtocol(protocol: string): 'ws:' | 'wss:' {
  return protocol === 'https:' || protocol === 'wss:' ? 'wss:' : 'ws:';
}

export function normalizeBuzzEndpoints(input: {
  relayHttpUrl: string;
  relayWebSocketUrl?: string;
  expectedCommunity?: string;
}): NormalizedBuzzEndpoints {
  const primary = parseRelayUrl(input.relayHttpUrl, 'Buzz relay HTTP URL');
  const http = withProtocol(primary, httpProtocol(primary.protocol));
  const derivedWebSocket = withProtocol(primary, webSocketProtocol(primary.protocol));

  let webSocket = derivedWebSocket;
  if (input.relayWebSocketUrl) {
    const configuredWebSocket = parseRelayUrl(input.relayWebSocketUrl, 'Buzz relay WebSocket URL');
    webSocket = withProtocol(configuredWebSocket, webSocketProtocol(configuredWebSocket.protocol));
    const wsAsHttp = withProtocol(webSocket, httpProtocol(webSocket.protocol));
    if (
      normalizedAuthority(http) !== normalizedAuthority(wsAsHttp) ||
      trimTrailingSlash(http.pathname) !== trimTrailingSlash(wsAsHttp.pathname) ||
      (http.protocol === 'https:') !== (wsAsHttp.protocol === 'https:')
    ) {
      throw new BuzzProbeError(
        'misconfigured',
        'endpoint_mismatch',
        'Buzz HTTP and WebSocket endpoints do not identify the same relay authority and path.',
        'Configure matching http/ws or https/wss endpoints for the same host, port, and path.'
      );
    }
  }

  const community = normalizedAuthority(http);
  const expectedCommunity = input.expectedCommunity
    ? normalizeCommunity(input.expectedCommunity)
    : undefined;

  return {
    configuredHttpUrl: input.relayHttpUrl,
    configuredWebSocketUrl: input.relayWebSocketUrl,
    httpUrl: baseUrl(http),
    webSocketUrl: baseUrl(webSocket),
    community,
    expectedCommunity,
  };
}

export function fingerprintBuzzPublicKey(publicKey: string): string {
  return createHash('sha256').update(publicKey.toLowerCase()).digest('hex').slice(0, 12);
}

function endpoint(base: string, path: string): string {
  return `${base}${path}`;
}

function emptyChecks(): BuzzCompatibilityChecks {
  return {
    relayIdentity: 'unverified',
    communityBinding: 'unverified',
    configuredIdentity: 'unverified',
    authentication: 'unverified',
    membership: 'unverified',
    channelRead: 'unverified',
    messageRead: 'unverified',
  };
}

function stripTerminalControlSequences(value: string): string {
  let result = '';
  let index = 0;
  while (index < value.length) {
    const code = value.charCodeAt(index);
    if (code === 0x1b) {
      index += 1;
      const introducer = value[index];
      if (introducer === '[') {
        index += 1;
        while (index < value.length) {
          const sequenceCode = value.charCodeAt(index);
          index += 1;
          if (sequenceCode >= 0x40 && sequenceCode <= 0x7e) break;
        }
      } else if (introducer === ']') {
        index += 1;
        while (index < value.length) {
          if (value.charCodeAt(index) === 0x07) {
            index += 1;
            break;
          }
          if (value.charCodeAt(index) === 0x1b && value.charCodeAt(index + 1) === 0x5c) {
            index += 2;
            break;
          }
          index += 1;
        }
      } else if (index < value.length) {
        index += 1;
      }
      continue;
    }
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) {
      index += 1;
      continue;
    }
    result += value[index];
    index += 1;
  }
  return result;
}

function sanitizeDetail(value: unknown): string {
  const raw = value instanceof Error ? value.message : String(value);
  const withoutControls = stripTerminalControlSequences(raw);
  return redactString(withoutControls)
    .replace(/nsec1[a-z0-9]+/gi, '[REDACTED]')
    .slice(0, 500);
}

function sanitizeConfiguredUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const parsed = new URL(value);
    parsed.username = '';
    parsed.password = '';
    parsed.search = '';
    parsed.hash = '';
    return baseUrl(parsed);
  } catch {
    return '[invalid-url]';
  }
}

function sanitizeConfiguredCommunity(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    return normalizeCommunity(value);
  } catch {
    return '[invalid-community]';
  }
}

function parseCanonicalDecimal(value: string, max: number): number | undefined {
  if (!/^(?:0|[1-9][0-9]*)$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed <= max ? parsed : undefined;
}

function isValidAuthTagConditions(value: string): boolean {
  if (!value) return true;
  return value.split('&').every((clause) => {
    if (clause.startsWith('kind=')) {
      return parseCanonicalDecimal(clause.slice('kind='.length), 65_535) !== undefined;
    }
    if (clause.startsWith('created_at<')) {
      return parseCanonicalDecimal(clause.slice('created_at<'.length), 4_294_967_295) !== undefined;
    }
    if (clause.startsWith('created_at>')) {
      return parseCanonicalDecimal(clause.slice('created_at>'.length), 4_294_967_295) !== undefined;
    }
    return false;
  });
}

export function validateBuzzAuthTag(value: string): string {
  if (Buffer.byteLength(value, 'utf8') > MAX_AUTH_TAG_BYTES) {
    throw new BuzzProbeError(
      'misconfigured',
      'auth_tag_invalid',
      'The configured Buzz NIP-OA auth tag exceeds the 1,024-byte limit.',
      'Replace the referenced value with a valid Buzz NIP-OA auth tag.'
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new BuzzProbeError(
      'misconfigured',
      'auth_tag_invalid',
      'The configured Buzz NIP-OA auth tag is not valid JSON.',
      'Set the referenced value to the four-field Buzz NIP-OA auth-tag array.'
    );
  }
  if (
    !Array.isArray(parsed) ||
    parsed.length !== 4 ||
    parsed[0] !== 'auth' ||
    typeof parsed[1] !== 'string' ||
    typeof parsed[2] !== 'string' ||
    typeof parsed[3] !== 'string' ||
    !/^[a-f0-9]{64}$/.test(parsed[1]) ||
    !isValidAuthTagConditions(parsed[2]) ||
    !/^[a-f0-9]{128}$/.test(parsed[3])
  ) {
    throw new BuzzProbeError(
      'misconfigured',
      'auth_tag_invalid',
      'The configured Buzz NIP-OA auth tag does not match the supported four-field contract.',
      'Regenerate the auth tag with Buzz and update the referenced environment secret.'
    );
  }
  return JSON.stringify(parsed);
}

async function readBoundedBody(
  response: Response,
  limit: number,
  signal?: AbortSignal
): Promise<string> {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let result = '';
  const read = async () => {
    if (!signal) return reader.read();
    if (signal.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
    return new Promise<Awaited<ReturnType<typeof reader.read>>>((resolve, reject) => {
      const onAbort = () => {
        void reader.cancel().catch(() => {});
        reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
      };
      signal.addEventListener('abort', onAbort, { once: true });
      reader
        .read()
        .then(resolve, reject)
        .finally(() => {
          signal.removeEventListener('abort', onAbort);
        });
    });
  };
  try {
    while (true) {
      const chunk = await read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > limit) {
        await reader.cancel();
        throw new BuzzProbeError(
          'unsupported',
          'response_too_large',
          `Buzz relay response exceeded the ${limit}-byte diagnostic limit.`,
          'Inspect the relay or reverse proxy response before retrying.'
        );
      }
      result += decoder.decode(chunk.value, { stream: true });
    }
    return result + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}

function parseRelayContract(body: string): BuzzRelayContract {
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    throw new BuzzProbeError(
      'unsupported',
      'relay_info_invalid',
      'Buzz relay metadata was not valid JSON.',
      'Confirm the configured endpoint serves Buzz NIP-11 metadata.'
    );
  }
  if (!value || typeof value !== 'object') {
    throw new BuzzProbeError(
      'unsupported',
      'relay_info_invalid',
      'Buzz relay metadata was not an object.',
      'Confirm the configured endpoint serves Buzz NIP-11 metadata.'
    );
  }
  const record = value as Record<string, unknown>;
  const supportedNips = Array.isArray(record.supported_nips)
    ? record.supported_nips.filter((item): item is number => Number.isInteger(item))
    : [];
  const supportedExtensions = Array.isArray(record.supported_extensions)
    ? record.supported_extensions.filter((item): item is string => typeof item === 'string')
    : [];
  const limitation =
    record.limitation && typeof record.limitation === 'object'
      ? (record.limitation as Record<string, unknown>)
      : {};

  if (
    typeof record.software !== 'string' ||
    typeof record.version !== 'string' ||
    typeof record.self !== 'string' ||
    !/^[a-fA-F0-9]{64}$/.test(record.self) ||
    REQUIRED_NIPS.some((nip) => !supportedNips.includes(nip))
  ) {
    throw new BuzzProbeError(
      'unsupported',
      'relay_info_invalid',
      'Relay metadata is missing the Buzz software/version or required NIP contract.',
      `Use a supported Buzz ${BUZZ_TESTED_RELEASE} relay or update the compatibility policy.`
    );
  }

  return {
    software: record.software,
    version: record.version.replace(/^v/, ''),
    supportedNips,
    supportedExtensions,
    relayPublicKey:
      typeof record.self === 'string' && /^[a-fA-F0-9]{64}$/.test(record.self)
        ? record.self.toLowerCase()
        : undefined,
    authRequired: limitation.auth_required === true,
  };
}

function evidenceKey(input: {
  config: BuzzProbeConfig;
  endpoints?: NormalizedBuzzEndpoints;
  contract?: BuzzRelayContract;
  commands: BuzzCommandDiagnostic[];
  observedSigningPublicKey?: string;
}): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        probeRevision: BUZZ_PROBE_REVISION,
        relayHttpUrl: input.endpoints?.httpUrl ?? input.config.relayHttpUrl,
        relayWebSocketUrl: input.endpoints?.webSocketUrl ?? input.config.relayWebSocketUrl,
        expectedCommunity: input.endpoints?.expectedCommunity ?? input.config.expectedCommunity,
        publicKey: input.config.publicKey.toLowerCase(),
        observedSigningPublicKey: input.observedSigningPublicKey,
        credentialRef: input.config.credentialRef,
        authTagRef: input.config.authTagRef,
        allowLocalhost: Boolean(input.config.allowLocalhost),
        allowPrivateNetwork: Boolean(input.config.allowPrivateNetwork),
        command: input.config.command,
        contract: input.contract,
        commands: input.commands,
      })
    )
    .digest('hex');
}

export class BuzzCompatibilityService {
  private readonly fetch: NonNullable<BuzzCompatibilityServiceOptions['fetch']>;
  private readonly resolveSecret: NonNullable<BuzzCompatibilityServiceOptions['resolveSecret']>;
  private readonly signer: BuzzNip98Signer;
  private readonly runCommand: BuzzCommandRunner;
  private readonly now: () => Date;
  private readonly timeoutMs: number;
  private readonly maxResponseBytes: number;

  constructor(options: BuzzCompatibilityServiceOptions = {}) {
    this.fetch = options.fetch ?? safeFetch;
    this.resolveSecret =
      options.resolveSecret ??
      (async (reference) => {
        if (!reference.startsWith('env:')) return undefined;
        return new EnvironmentCredentialSecretSource().resolve({
          kind: 'environment',
          reference: reference.slice(4),
        });
      });
    this.signer = options.signer ?? new NostrToolsBuzzNip98Signer();
    this.runCommand =
      options.runCommand ??
      (async (executable, args) => {
        const result = await execFileAsync(executable, args, {
          timeout: this.timeoutMs,
          maxBuffer: 64 * 1024,
          windowsHide: true,
          env: buildBuzzCommandEnvironment(),
        });
        return { stdout: result.stdout, stderr: result.stderr };
      });
    this.now = options.now ?? (() => new Date());
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxResponseBytes = options.maxResponseBytes ?? MAX_RESPONSE_BYTES;
  }

  async probe(config: BuzzProbeConfig): Promise<BuzzCompatibilityResult> {
    const checkedAt = this.now().toISOString();
    const commands = await this.discoverCommands(config.command);
    const checks = emptyChecks();
    let endpoints: NormalizedBuzzEndpoints | undefined;
    let contract: BuzzRelayContract | undefined;
    let observedSigningPublicKey: string | undefined;

    const result = (
      status: BuzzCompatibilityStatus,
      reasonCode: BuzzCompatibilityReasonCode,
      detail: string,
      remediation?: string
    ): BuzzCompatibilityResult => ({
      schemaVersion: BUZZ_COMPATIBILITY_SCHEMA_VERSION,
      probeRevision: BUZZ_PROBE_REVISION,
      testedRelease: BUZZ_TESTED_RELEASE,
      testedCommit: BUZZ_TESTED_COMMIT,
      status,
      reasonCode,
      detail: sanitizeDetail(detail),
      remediation: remediation ? sanitizeDetail(remediation) : undefined,
      configuredRelayHttpUrl: sanitizeConfiguredUrl(config.relayHttpUrl) ?? '[not-configured]',
      resolvedRelayHttpUrl: endpoints?.httpUrl,
      configuredRelayWebSocketUrl: sanitizeConfiguredUrl(config.relayWebSocketUrl),
      resolvedRelayWebSocketUrl: endpoints?.webSocketUrl,
      expectedCommunity:
        endpoints?.expectedCommunity ?? sanitizeConfiguredCommunity(config.expectedCommunity),
      observedCommunity: endpoints?.community,
      publicKeyFingerprint: fingerprintBuzzPublicKey(config.publicKey),
      contract,
      checks: { ...checks },
      commands,
      evidenceKey: evidenceKey({
        config,
        endpoints,
        contract,
        commands,
        observedSigningPublicKey,
      }),
      checkedAt,
    });

    try {
      endpoints = normalizeBuzzEndpoints(config);
      if (endpoints.expectedCommunity && endpoints.expectedCommunity !== endpoints.community) {
        checks.communityBinding = 'failed';
        throw new BuzzProbeError(
          'misconfigured',
          'community_mismatch',
          `Configured relay resolves to community ${endpoints.community}, not the expected community.`,
          'Correct the relay host or expected community. Buzz binds community identity to the request host.'
        );
      }

      const infoResult = await this.fetchBoundedWithTimeout(
        endpoint(endpoints.httpUrl, '/info'),
        {
          method: 'GET',
          headers: { Accept: 'application/nostr+json' },
        },
        config
      );
      if (!infoResult) {
        throw new BuzzProbeError(
          'unreachable',
          'network_policy_blocked',
          'The relay endpoint was blocked by the outbound network policy or DNS validation.',
          'Use a public HTTPS relay or explicitly allow the required local/private network class.'
        );
      }
      const { response: infoResponse, body: infoBody } = infoResult;
      if (!infoResponse.ok) {
        throw new BuzzProbeError(
          'unreachable',
          'relay_unreachable',
          `Buzz relay metadata request returned HTTP ${infoResponse.status}.`,
          'Verify the relay endpoint, reverse proxy, and host mapping.'
        );
      }
      contract = parseRelayContract(infoBody);
      if (contract.software.replace(/\/$/, '') !== BUZZ_REPOSITORY) {
        checks.relayIdentity = 'failed';
        throw new BuzzProbeError(
          'unsupported',
          'relay_software_mismatch',
          'The configured endpoint does not identify itself as the supported Buzz relay.',
          `Point Veritas at a Buzz ${BUZZ_TESTED_RELEASE} relay.`
        );
      }
      if (contract.version !== BUZZ_TESTED_RELEASE) {
        checks.relayIdentity = 'verified';
        throw new BuzzProbeError(
          'unsupported',
          'relay_version_unsupported',
          `Buzz relay ${contract.version} is outside the tested ${BUZZ_TESTED_RELEASE} contract.`,
          'Upgrade or pin Buzz to the tested release, or update the Veritas compatibility policy with fixtures.'
        );
      }
      checks.relayIdentity = 'verified';
      const verifiedContract = contract;

      const privateKey = await this.resolveSecret(config.credentialRef);
      if (!privateKey) {
        throw new BuzzProbeError(
          'misconfigured',
          'credential_unavailable',
          'The configured Buzz signing-key reference is unavailable.',
          `Inject the environment secret named by ${config.credentialRef}.`
        );
      }
      const authTag = config.authTagRef ? await this.resolveSecret(config.authTagRef) : undefined;
      if (config.authTagRef && !authTag) {
        throw new BuzzProbeError(
          'misconfigured',
          'credential_unavailable',
          'The configured Buzz NIP-OA auth-tag reference is unavailable.',
          `Inject the environment secret named by ${config.authTagRef}.`
        );
      }
      const validatedAuthTag = authTag ? validateBuzzAuthTag(authTag) : undefined;
      const queryUrl = endpoint(endpoints.httpUrl, '/query');
      const verifyReadCapability = async (
        kind: 39_000 | 9,
        capability: 'channelRead' | 'messageRead',
        label: string
      ): Promise<void> => {
        const body = JSON.stringify([{ kinds: [kind], limit: 1 }]);
        const signed = await this.signer.sign({
          privateKey,
          method: 'POST',
          url: queryUrl,
          body,
        });
        observedSigningPublicKey = signed.publicKey.toLowerCase();
        if (observedSigningPublicKey !== config.publicKey.toLowerCase()) {
          checks.configuredIdentity = 'failed';
          throw new BuzzProbeError(
            'misconfigured',
            'public_key_mismatch',
            'The configured signing secret does not match the configured public identity.',
            'Correct the public key or signing-key secret reference.'
          );
        }
        checks.configuredIdentity = 'verified';

        const headers: Record<string, string> = {
          Accept: 'application/json',
          Authorization: signed.authorization,
          'Content-Type': 'application/json',
        };
        if (validatedAuthTag) headers['x-auth-tag'] = validatedAuthTag;
        const queryResult = await this.fetchBoundedWithTimeout(
          queryUrl,
          { method: 'POST', headers, body },
          config
        );
        if (!queryResult) {
          throw new BuzzProbeError(
            'unreachable',
            'network_policy_blocked',
            `The authenticated Buzz ${label} query was blocked by network policy.`,
            'Review the relay URL and explicit local/private network allowances.'
          );
        }
        const { response: queryResponse, body: queryBody } = queryResult;
        if (queryResponse.status === 401) {
          checks.authentication = 'failed';
          throw new BuzzProbeError(
            'unauthorized',
            'authentication_rejected',
            'Buzz rejected the NIP-98 identity proof.',
            'Verify the signing key, relay URL host, system clock, and Buzz NIP-98 configuration.'
          );
        }
        if (queryResponse.status === 403) {
          checks.authentication = 'verified';
          if (queryBody.includes('relay_membership_required')) {
            checks.membership = 'failed';
            throw new BuzzProbeError(
              'not_member',
              'relay_membership_required',
              'Buzz authenticated the identity but denied relay membership.',
              'Add the public identity as a relay member or provide a valid NIP-OA auth tag.'
            );
          }
          checks.membership = verifiedContract.supportedNips.includes(43)
            ? 'verified'
            : 'not_enforced';
          checks[capability] = 'failed';
          throw new BuzzProbeError(
            'unauthorized',
            'read_capability_rejected',
            `Buzz authenticated the identity but rejected the ${label} read probe.`,
            'Review channel membership and relay read policy for the configured identity.'
          );
        }
        if (queryResponse.status === 404) {
          checks.communityBinding = 'failed';
          throw new BuzzProbeError(
            'misconfigured',
            'community_mismatch',
            'Buzz could not bind the authenticated query host to a community.',
            'Use the exact configured community host, including any non-default port.'
          );
        }
        if (queryResponse.status === 429) {
          throw new BuzzProbeError(
            'degraded',
            'relay_rate_limited',
            `Buzz rate-limited the ${label} read probe.`,
            'Retry after the relay rate-limit window.'
          );
        }
        if (!queryResponse.ok) {
          throw new BuzzProbeError(
            'degraded',
            'relay_error',
            `Buzz returned HTTP ${queryResponse.status} for the ${label} read probe.`,
            'Inspect relay health and retry without enabling message delivery.'
          );
        }
        checks.authentication = 'verified';
        checks.communityBinding = 'verified';
        checks.membership = verifiedContract.supportedNips.includes(43)
          ? 'verified'
          : 'not_enforced';
        try {
          const parsed = JSON.parse(queryBody);
          if (!Array.isArray(parsed)) throw new Error('query response is not an array');
        } catch {
          throw new BuzzProbeError(
            'unsupported',
            'query_response_invalid',
            `Buzz returned an invalid ${label} query response.`,
            'Verify the relay build and reverse proxy response handling.'
          );
        }
        checks[capability] = 'verified';
      };

      await verifyReadCapability(39_000, 'channelRead', 'channel metadata');
      await verifyReadCapability(9, 'messageRead', 'message');
      return result(
        'healthy',
        'ok',
        'Buzz relay identity, configured signing identity, membership posture, and read capabilities are compatible.'
      );
    } catch (error) {
      if (error instanceof BuzzProbeError) {
        return result(error.status, error.reasonCode, error.message, error.remediation);
      }
      return result(
        'unreachable',
        'relay_unreachable',
        `Buzz compatibility probe failed: ${sanitizeDetail(error)}`,
        'Verify relay reachability, DNS, TLS, and the configured network-policy allowances.'
      );
    }
  }

  private async fetchBoundedWithTimeout(
    url: string,
    init: RequestInit,
    config: BuzzProbeConfig
  ): Promise<{ response: Response; body: string } | null> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetch(
        url,
        { ...init, signal: controller.signal, redirect: 'manual' },
        {
          allowHttp: Boolean(config.allowLocalhost || config.allowPrivateNetwork),
          allowLocalhost: Boolean(config.allowLocalhost),
          allowPrivateNetwork: Boolean(config.allowPrivateNetwork),
        }
      );
      if (!response) return null;
      const body = await readBoundedBody(response, this.maxResponseBytes, controller.signal);
      return { response, body };
    } finally {
      clearTimeout(timeout);
    }
  }

  private async discoverCommands(command?: BuzzCommandConfig): Promise<BuzzCommandDiagnostic[]> {
    const candidates: Array<{
      command: BuzzCommandDiagnostic['command'];
      executable: string;
      args: string[];
    }> = [
      { command: 'buzz', executable: 'buzz', args: ['--version'] },
      { command: 'buzz-acp', executable: 'buzz-acp', args: ['--version'] },
      { command: 'buzz-agent', executable: 'buzz-agent', args: ['--version'] },
    ];
    if (command) {
      candidates.push({
        command: 'configured',
        executable: command.executable,
        args: [...(command.args ?? []), '--version'],
      });
    }

    return Promise.all(
      candidates.map(async (candidate): Promise<BuzzCommandDiagnostic> => {
        try {
          const output = await this.runCommand(candidate.executable, candidate.args);
          const version = `${output.stdout}\n${output.stderr}`.trim().split(/\r?\n/, 1)[0];
          return {
            command: candidate.command,
            executable: candidate.executable,
            available: true,
            version: sanitizeDetail(version || 'version not reported'),
          };
        } catch (error) {
          const code =
            error && typeof error === 'object' && 'code' in error
              ? String((error as { code?: unknown }).code)
              : undefined;
          return {
            command: candidate.command,
            executable: candidate.executable,
            available: false,
            detail:
              code === 'ENOENT'
                ? 'not found'
                : sanitizeDetail(code ? `command failed (${code})` : 'command failed'),
          };
        }
      })
    );
  }
}
