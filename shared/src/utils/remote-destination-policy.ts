const BLOCKED_IPV4_RANGES: Array<{ start: number; end: number; reason: string }> = [
  { start: 0x00000000, end: 0x00000000, reason: 'unspecified local address' },
  { start: 0x0a000000, end: 0x0affffff, reason: 'private IPv4 address' },
  { start: 0x7f000000, end: 0x7fffffff, reason: 'loopback address' },
  { start: 0xa9fe0000, end: 0xa9feffff, reason: 'link-local address' },
  { start: 0xac100000, end: 0xac1fffff, reason: 'private IPv4 address' },
  { start: 0xc0a80000, end: 0xc0a8ffff, reason: 'private IPv4 address' },
  { start: 0x64400000, end: 0x647fffff, reason: 'carrier-grade NAT address' },
];

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;

  let result = 0;
  for (const part of parts) {
    if (!/^\d+$/.test(part)) return null;
    const num = Number.parseInt(part, 10);
    if (Number.isNaN(num) || num < 0 || num > 255) return null;
    result = (result << 8) | num;
  }
  return result >>> 0;
}

function blockedIPv4Reason(ip: string): string | null {
  const ipInt = ipv4ToInt(ip);
  if (ipInt === null) return null;

  for (const range of BLOCKED_IPV4_RANGES) {
    if (ipInt >= range.start && ipInt <= range.end) return range.reason;
  }
  return null;
}

function firstIPv6Hextet(address: string): number | null {
  const normalized = address.replace(/^\[/, '').replace(/\]$/, '').toLowerCase();
  const first = normalized.split(':', 1)[0];
  if (!first || !/^[0-9a-f]{1,4}$/.test(first)) return null;
  return Number.parseInt(first, 16);
}

function blockedIPv6Reason(hostname: string): string | null {
  const normalized = hostname.replace(/^\[/, '').replace(/\]$/, '').toLowerCase();
  if (normalized === '::') return 'IPv6 unspecified address';
  if (normalized === '::1') return 'IPv6 loopback address';

  if (normalized.startsWith('::ffff:')) {
    const mappedReason = blockedIPv4Reason(normalized.slice('::ffff:'.length));
    if (mappedReason) return `IPv4-mapped ${mappedReason}`;
  }

  const firstHextet = firstIPv6Hextet(normalized);
  if (firstHextet === null) return null;

  if (firstHextet >= 0xfe80 && firstHextet <= 0xfebf) {
    return 'IPv6 link-local address';
  }
  if (firstHextet >= 0xfc00 && firstHextet <= 0xfdff) {
    return 'IPv6 unique-local address';
  }
  return null;
}

export function blockedRemoteConnectionDestinationReason(hostnameOrAddress: string): string | null {
  const hostname = hostnameOrAddress.toLowerCase();
  if (
    hostname === 'localhost' ||
    hostname === 'localhost.localdomain' ||
    hostname.endsWith('.localhost')
  ) {
    return 'localhost destination';
  }
  if (hostname === 'metadata.google.internal') {
    return 'cloud metadata destination';
  }
  if (hostname.includes(':')) return blockedIPv6Reason(hostname);
  return blockedIPv4Reason(hostname);
}
