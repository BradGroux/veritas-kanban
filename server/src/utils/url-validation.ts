/**
 * URL Validation Utility - SSRF Prevention
 *
 * Validates outbound webhook URLs to prevent Server-Side Request Forgery (SSRF) attacks.
 * Blocks requests to:
 * - Private IP ranges (RFC 1918, RFC 4193)
 * - Loopback addresses (127.0.0.0/8, ::1)
 * - Link-local addresses (169.254.0.0/16, fe80::/10)
 * - Cloud metadata endpoints (169.254.169.254)
 *
 * @see docs/SECURITY_AUDIT_2026-01-28.md — SSRF prevention
 */

import { lookup } from 'node:dns/promises';
import { request as httpRequest, type IncomingHttpHeaders, type RequestOptions } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { BlockList, isIP } from 'node:net';
import { Readable } from 'node:stream';
import { createLogger } from '../lib/logger.js';

const log = createLogger('url-validation');

// ─── Private IP Detection ──────────────────────────────────────────────────

/**
 * IPv4 private/reserved ranges that should be blocked for outbound requests
 */
type BlockedAddressClass = 'local' | 'private' | 'link-local' | 'cgnat' | 'unique-local';

interface BlockedAddressCheck {
  blocked: boolean;
  reason?: string;
  addressClass?: BlockedAddressClass;
}

const BLOCKED_IPV4_RANGES: Array<{
  start: number;
  end: number;
  name: string;
  addressClass: BlockedAddressClass;
}> = [
  // Unspecified local address
  { start: 0x00000000, end: 0x00000000, name: 'unspecified-local', addressClass: 'local' },
  // Loopback (127.0.0.0/8)
  { start: 0x7f000000, end: 0x7fffffff, name: 'loopback', addressClass: 'local' },
  // Private Class A (10.0.0.0/8)
  { start: 0x0a000000, end: 0x0affffff, name: 'private-A', addressClass: 'private' },
  // Private Class B (172.16.0.0/12)
  { start: 0xac100000, end: 0xac1fffff, name: 'private-B', addressClass: 'private' },
  // Private Class C (192.168.0.0/16)
  { start: 0xc0a80000, end: 0xc0a8ffff, name: 'private-C', addressClass: 'private' },
  // Link-local (169.254.0.0/16) - includes AWS/GCP/Azure metadata
  { start: 0xa9fe0000, end: 0xa9feffff, name: 'link-local', addressClass: 'link-local' },
  // Carrier-grade NAT (100.64.0.0/10)
  { start: 0x64400000, end: 0x647fffff, name: 'cgnat', addressClass: 'cgnat' },
];

function ipv4BlockList(subnets: Array<[address: string, prefix: number]>): BlockList {
  const blockList = new BlockList();
  for (const [address, prefix] of subnets) {
    blockList.addSubnet(address, prefix, 'ipv4');
  }
  return blockList;
}

const MAPPED_IPV4_LOCAL = ipv4BlockList([
  ['0.0.0.0', 32],
  ['127.0.0.0', 8],
]);
const MAPPED_IPV4_PRIVATE = ipv4BlockList([
  ['10.0.0.0', 8],
  ['172.16.0.0', 12],
  ['192.168.0.0', 16],
]);
const MAPPED_IPV4_LINK_LOCAL = ipv4BlockList([['169.254.0.0', 16]]);
const MAPPED_IPV4_CGNAT = ipv4BlockList([['100.64.0.0', 10]]);

const IPV6_LOCAL = new BlockList();
IPV6_LOCAL.addSubnet('::', 96, 'ipv6');
const IPV6_LINK_LOCAL = new BlockList();
IPV6_LINK_LOCAL.addSubnet('fe80::', 10, 'ipv6');
const IPV6_UNIQUE_LOCAL = new BlockList();
IPV6_UNIQUE_LOCAL.addSubnet('fc00::', 7, 'ipv6');

/**
 * Convert IPv4 address string to 32-bit integer
 */
function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;

  let result = 0;
  for (const part of parts) {
    const num = parseInt(part, 10);
    if (isNaN(num) || num < 0 || num > 255) return null;
    result = (result << 8) | num;
  }
  return result >>> 0; // Ensure unsigned
}

/**
 * Check if an IPv4 address is in a blocked range
 */
function isBlockedIPv4(ip: string): BlockedAddressCheck {
  const ipInt = ipv4ToInt(ip);
  if (ipInt === null) {
    return { blocked: false }; // Invalid IP, let URL parsing handle it
  }

  for (const range of BLOCKED_IPV4_RANGES) {
    if (ipInt >= range.start && ipInt <= range.end) {
      return {
        blocked: true,
        reason: `IP in ${range.name} range`,
        addressClass: range.addressClass,
      };
    }
  }

  return { blocked: false };
}

/**
 * Check if a hostname is a blocked IPv6 address
 */
function isBlockedIPv6(host: string): BlockedAddressCheck {
  const normalized = unbracketHostname(host).toLowerCase();

  if (IPV6_LOCAL.check(normalized, 'ipv6') || MAPPED_IPV4_LOCAL.check(normalized, 'ipv6')) {
    return { blocked: true, reason: 'IPv6 local address', addressClass: 'local' };
  }
  if (
    IPV6_LINK_LOCAL.check(normalized, 'ipv6') ||
    MAPPED_IPV4_LINK_LOCAL.check(normalized, 'ipv6')
  ) {
    return { blocked: true, reason: 'IPv6 link-local', addressClass: 'link-local' };
  }
  if (IPV6_UNIQUE_LOCAL.check(normalized, 'ipv6')) {
    return { blocked: true, reason: 'IPv6 unique-local', addressClass: 'unique-local' };
  }
  if (MAPPED_IPV4_PRIVATE.check(normalized, 'ipv6')) {
    return { blocked: true, reason: 'IPv4-mapped private address', addressClass: 'private' };
  }
  if (MAPPED_IPV4_CGNAT.check(normalized, 'ipv6')) {
    return { blocked: true, reason: 'IPv4-mapped CGNAT address', addressClass: 'cgnat' };
  }

  return { blocked: false };
}

function isAllowedBlockedAddress(check: BlockedAddressCheck, opts: UrlValidationOptions): boolean {
  if (!check.blocked) {
    return true;
  }
  if (opts.allowPrivateIp) {
    return true;
  }
  if (opts.allowLocalhost && check.addressClass === 'local') {
    return true;
  }
  return Boolean(
    opts.allowPrivateNetwork &&
    (check.addressClass === 'private' || check.addressClass === 'unique-local')
  );
}

function isBlockedIpAddress(address: string, opts: UrlValidationOptions): BlockedAddressCheck {
  if (isIP(address) === 4) {
    const check = isBlockedIPv4(address);
    if (!isAllowedBlockedAddress(check, opts)) {
      return check;
    }
  }

  if (isIP(address) === 6) {
    const check = isBlockedIPv6(address);
    if (!isAllowedBlockedAddress(check, opts)) {
      return check;
    }
  }

  return { blocked: false };
}

/**
 * Check if hostname resolves to localhost variants
 */
function isLocalhostHostname(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  return (
    lower === 'localhost' ||
    lower === 'localhost.localdomain' ||
    lower.endsWith('.localhost') ||
    lower === '0.0.0.0'
  );
}

function unbracketHostname(hostname: string): string {
  return hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname;
}

// ─── URL Validation ────────────────────────────────────────────────────────

export interface UrlValidationResult {
  valid: boolean;
  reason?: string;
  normalized?: string;
}

export interface ResolvedOutboundAddress {
  address: string;
  family: 4 | 6;
}

export interface ResolvedOutboundUrl {
  url: string;
  hostname: string;
  resolvedAddress: ResolvedOutboundAddress;
}

interface ResolvedUrlValidationResult extends UrlValidationResult {
  resolvedAddress?: ResolvedOutboundAddress;
}

export interface UrlValidationOptions {
  /** Allow http:// in addition to https:// (default: false in production) */
  allowHttp?: boolean;
  /** Allow localhost/loopback addresses only (default: true in development only) */
  allowLocalhost?: boolean;
  /** Allow private IP ranges (default: false) */
  allowPrivateIp?: boolean;
  /** Allow RFC1918/ULA networks while continuing to block link-local and CGNAT ranges */
  allowPrivateNetwork?: boolean;
  /** Log validation failures (default: true) */
  logFailures?: boolean;
}

const DEFAULT_OPTIONS: UrlValidationOptions = {
  allowHttp: process.env.NODE_ENV === 'development',
  allowLocalhost: process.env.NODE_ENV === 'development',
  allowPrivateIp: false,
  allowPrivateNetwork: false,
  logFailures: true,
};

/**
 * Validate a webhook URL for SSRF prevention
 *
 * @param url - The URL to validate
 * @param options - Validation options
 * @returns Validation result with reason if invalid
 *
 * @example
 * const result = validateWebhookUrl('https://hooks.slack.com/services/...');
 * if (!result.valid) {
 *   log.warn({ reason: result.reason }, 'Webhook URL blocked');
 *   return;
 * }
 */
export function validateWebhookUrl(
  url: string | undefined,
  options: UrlValidationOptions = {}
): UrlValidationResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  // Empty URL is valid (webhook disabled)
  if (!url || url.trim() === '') {
    return { valid: true };
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { valid: false, reason: 'Invalid URL format' };
  }

  // Protocol validation
  const allowedProtocols = opts.allowHttp ? ['https:', 'http:'] : ['https:'];
  if (!allowedProtocols.includes(parsed.protocol)) {
    const result = {
      valid: false,
      reason: `Protocol not allowed: ${parsed.protocol} (allowed: ${allowedProtocols.join(', ')})`,
    };
    if (opts.logFailures) {
      log.warn({ url: parsed.origin, reason: result.reason }, 'Webhook URL blocked');
    }
    return result;
  }

  const hostname = parsed.hostname;

  // Localhost check
  if (!opts.allowLocalhost && isLocalhostHostname(hostname)) {
    const result = { valid: false, reason: 'Localhost URLs not allowed' };
    if (opts.logFailures) {
      log.warn({ url: parsed.origin, reason: result.reason }, 'Webhook URL blocked');
    }
    return result;
  }

  // IPv4 private range check
  const ipv4Check = isBlockedIPv4(hostname);
  if (!isAllowedBlockedAddress(ipv4Check, opts)) {
    const result = { valid: false, reason: ipv4Check.reason };
    if (opts.logFailures) {
      log.warn({ url: parsed.origin, reason: result.reason }, 'Webhook URL blocked');
    }
    return result;
  }

  // IPv6 check
  const ipv6Check = isBlockedIPv6(hostname);
  if (!isAllowedBlockedAddress(ipv6Check, opts)) {
    const result = { valid: false, reason: ipv6Check.reason };
    if (opts.logFailures) {
      log.warn({ url: parsed.origin, reason: result.reason }, 'Webhook URL blocked');
    }
    return result;
  }

  // Cloud metadata endpoint (explicit check for common patterns)
  if (hostname === '169.254.169.254' || hostname === 'metadata.google.internal') {
    const result = { valid: false, reason: 'Cloud metadata endpoint blocked' };
    if (opts.logFailures) {
      log.warn({ url: parsed.origin, reason: result.reason }, 'Webhook URL blocked');
    }
    return result;
  }

  return { valid: true, normalized: parsed.href };
}

async function validateResolvedHostname(
  parsed: URL,
  opts: UrlValidationOptions
): Promise<ResolvedUrlValidationResult> {
  const hostname = unbracketHostname(parsed.hostname);
  const directIpFamily = isIP(hostname);

  if (directIpFamily === 4 || directIpFamily === 6) {
    return {
      valid: true,
      normalized: parsed.href,
      resolvedAddress: { address: hostname, family: directIpFamily },
    };
  }

  try {
    const records = await lookup(hostname, { all: true, verbatim: true });
    const resolvedAddresses: ResolvedOutboundAddress[] = [];

    for (const record of records) {
      const family = isIP(record.address);
      if (family !== 4 && family !== 6) {
        continue;
      }

      const check = isBlockedIpAddress(record.address, opts);
      if (check.blocked) {
        const result = {
          valid: false,
          reason: `Hostname resolves to blocked address: ${check.reason}`,
        };
        if (opts.logFailures) {
          log.warn({ url: parsed.origin, reason: result.reason }, 'Webhook URL blocked');
        }
        return result;
      }

      resolvedAddresses.push({ address: record.address, family });
    }

    if (resolvedAddresses.length === 0) {
      const result = { valid: false, reason: 'Hostname did not resolve to an IP address' };
      if (opts.logFailures) {
        log.warn({ url: parsed.origin, reason: result.reason }, 'Webhook URL blocked');
      }
      return result;
    }

    return { valid: true, normalized: parsed.href, resolvedAddress: resolvedAddresses[0] };
  } catch {
    const result = { valid: false, reason: 'Hostname could not be resolved' };
    if (opts.logFailures) {
      log.warn({ url: parsed.origin, reason: result.reason }, 'Webhook URL blocked');
    }
    return result;
  }
}

function headersFromInit(headers: RequestInit['headers'] | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  if (!headers) return result;

  const normalized = new Headers(headers);
  normalized.forEach((value, key) => {
    if (key.toLowerCase() !== 'host') {
      result[key] = value;
    }
  });
  return result;
}

function headersFromResponse(headers: IncomingHttpHeaders): Headers {
  const result = new Headers();
  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const item of value) {
        result.append(key, item);
      }
    } else {
      result.set(key, String(value));
    }
  }
  return result;
}

async function bodyFromInit(
  body: RequestInit['body'] | undefined
): Promise<string | Uint8Array | undefined> {
  if (body === undefined || body === null) return undefined;
  if (typeof body === 'string') return body;
  if (body instanceof URLSearchParams) return body.toString();
  if (body instanceof Uint8Array) return body;
  if (body instanceof ArrayBuffer) return new Uint8Array(body);
  if (ArrayBuffer.isView(body)) {
    return new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
  }
  if (body instanceof Blob) {
    return new Uint8Array(await body.arrayBuffer());
  }

  throw new TypeError('Unsupported outbound request body type');
}

async function fetchPinnedUrl(
  parsed: URL,
  resolvedAddress: ResolvedOutboundAddress,
  init?: RequestInit
): Promise<Response> {
  const pinnedLookup: NonNullable<RequestOptions['lookup']> = (_hostname, options, callback) => {
    const cb = typeof options === 'function' ? options : callback;
    if (!cb) {
      throw new Error('Pinned DNS lookup callback was not provided');
    }
    if (typeof options === 'object' && options?.all) {
      cb(null, [resolvedAddress]);
      return;
    }
    cb(null, resolvedAddress.address, resolvedAddress.family);
  };
  const requestBody = await bodyFromInit(init?.body ?? undefined);
  const requestHostname = unbracketHostname(parsed.hostname);
  const requestOptions: RequestOptions & { servername?: string } = {
    protocol: parsed.protocol,
    hostname: requestHostname,
    port: parsed.port || undefined,
    path: `${parsed.pathname}${parsed.search}`,
    method: init?.method ?? 'GET',
    headers: headersFromInit(init?.headers),
    signal: init?.signal ?? undefined,
    lookup: pinnedLookup,
  };

  if (parsed.protocol === 'https:') {
    requestOptions.servername = isIP(requestHostname) ? undefined : requestHostname;
  }

  const request = parsed.protocol === 'https:' ? httpsRequest : httpRequest;

  return new Promise((resolve, reject) => {
    const req = request(requestOptions, (res) => {
      const status = res.statusCode ?? 500;
      const responseBody =
        status === 204 || status === 304
          ? null
          : (Readable.toWeb(res) as unknown as ConstructorParameters<typeof Response>[0]);

      resolve(
        new Response(responseBody, {
          status,
          statusText: res.statusMessage,
          headers: headersFromResponse(res.headers),
        })
      );
    });

    req.on('error', reject);
    if (requestBody !== undefined) {
      req.write(requestBody);
    }
    req.end();
  });
}

/**
 * Safely fetch a URL after validation
 *
 * @param url - URL to fetch
 * @param init - Fetch options
 * @param validationOptions - URL validation options
 * @returns Fetch response or null if URL blocked
 */
export async function safeFetch(
  url: string,
  init?: RequestInit,
  validationOptions?: UrlValidationOptions
): Promise<Response | null> {
  const resolved = await resolveOutboundUrl(url, validationOptions);
  if (!resolved) return null;
  const parsed = new URL(resolved.url);

  return fetchPinnedUrl(parsed, resolved.resolvedAddress, {
    ...init,
    redirect: 'manual',
  });
}

export async function resolveOutboundUrl(
  url: string,
  validationOptions?: UrlValidationOptions
): Promise<ResolvedOutboundUrl | null> {
  const opts = { ...DEFAULT_OPTIONS, ...validationOptions };
  const validation = validateWebhookUrl(url, opts);
  if (!validation.valid) return null;

  const parsed = new URL(validation.normalized ?? url);
  const resolved = await validateResolvedHostname(parsed, opts);
  if (!resolved.valid || !resolved.resolvedAddress) return null;

  return {
    url: parsed.href,
    hostname: unbracketHostname(parsed.hostname),
    resolvedAddress: resolved.resolvedAddress,
  };
}
