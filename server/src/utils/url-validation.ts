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

import { createLogger } from '../lib/logger.js';

const log = createLogger('url-validation');

// ─── Private IP Detection ──────────────────────────────────────────────────

/**
 * IPv4 private/reserved ranges that should be blocked for outbound requests
 */
const BLOCKED_IPV4_RANGES: Array<{ start: number; end: number; name: string }> = [
  // Loopback (127.0.0.0/8)
  { start: 0x7f000000, end: 0x7fffffff, name: 'loopback' },
  // Private Class A (10.0.0.0/8)
  { start: 0x0a000000, end: 0x0affffff, name: 'private-A' },
  // Private Class B (172.16.0.0/12)
  { start: 0xac100000, end: 0xac1fffff, name: 'private-B' },
  // Private Class C (192.168.0.0/16)
  { start: 0xc0a80000, end: 0xc0a8ffff, name: 'private-C' },
  // Link-local (169.254.0.0/16) - includes AWS/GCP/Azure metadata
  { start: 0xa9fe0000, end: 0xa9feffff, name: 'link-local' },
  // Carrier-grade NAT (100.64.0.0/10)
  { start: 0x64400000, end: 0x647fffff, name: 'cgnat' },
];

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
function isBlockedIPv4(ip: string): { blocked: boolean; reason?: string } {
  const ipInt = ipv4ToInt(ip);
  if (ipInt === null) {
    return { blocked: false }; // Invalid IP, let URL parsing handle it
  }

  for (const range of BLOCKED_IPV4_RANGES) {
    if (ipInt >= range.start && ipInt <= range.end) {
      return { blocked: true, reason: `IP in ${range.name} range` };
    }
  }

  return { blocked: false };
}

/**
 * Check if a hostname is a blocked IPv6 address
 */
function isBlockedIPv6(host: string): { blocked: boolean; reason?: string } {
  const normalized = host.toLowerCase();

  // Loopback
  if (normalized === '::1' || normalized === '[::1]') {
    return { blocked: true, reason: 'IPv6 loopback' };
  }

  // Link-local (fe80::/10)
  if (normalized.startsWith('fe8') || normalized.startsWith('[fe8')) {
    return { blocked: true, reason: 'IPv6 link-local' };
  }

  // Unique local (fc00::/7)
  if (
    normalized.startsWith('fc') ||
    normalized.startsWith('fd') ||
    normalized.startsWith('[fc') ||
    normalized.startsWith('[fd')
  ) {
    return { blocked: true, reason: 'IPv6 unique-local' };
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

// ─── URL Validation ────────────────────────────────────────────────────────

export interface UrlValidationResult {
  valid: boolean;
  reason?: string;
  normalized?: string;
}

export interface UrlValidationOptions {
  /** Allow http:// in addition to https:// (default: false in production) */
  allowHttp?: boolean;
  /** Allow localhost/127.0.0.1 (default: true in development only) */
  allowLocalhost?: boolean;
  /** Allow private IP ranges (default: false) */
  allowPrivateIp?: boolean;
  /** Log validation failures (default: true) */
  logFailures?: boolean;
}

const DEFAULT_OPTIONS: UrlValidationOptions = {
  allowHttp: process.env.NODE_ENV === 'development',
  allowLocalhost: process.env.NODE_ENV === 'development',
  allowPrivateIp: false,
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
  if (ipv4Check.blocked && !opts.allowPrivateIp && !opts.allowLocalhost) {
    const result = { valid: false, reason: ipv4Check.reason };
    if (opts.logFailures) {
      log.warn({ url: parsed.origin, reason: result.reason }, 'Webhook URL blocked');
    }
    return result;
  }

  // IPv6 check
  const ipv6Check = isBlockedIPv6(hostname);
  if (ipv6Check.blocked && !opts.allowPrivateIp && !opts.allowLocalhost) {
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
  const validation = validateWebhookUrl(url, validationOptions);
  if (!validation.valid) {
    return null;
  }

  return fetch(url, init);
}
