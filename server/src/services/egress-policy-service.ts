import { createHash } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { domainToASCII } from 'node:url';
import {
  RUN_EGRESS_DECISION_SCHEMA_VERSION,
  RUN_EGRESS_POLICY_SCHEMA_VERSION,
  type RunEgressDecision,
  type RunEgressDecisionInput,
  type RunEgressDecisionReason,
  type RunEgressHostRule,
  type RunEgressPolicy,
  type SandboxNetworkRules,
} from '@veritas-kanban/shared';
import { ValidationError } from '../middleware/error-handler.js';
import { digestRunLaunchValue } from '../utils/run-launch-manifest-digest.js';

const METADATA_HOSTS = new Set([
  '169.254.169.254',
  '169.254.170.2',
  '100.100.100.200',
  'fd00:ec2::254',
  'metadata.google.internal',
  'metadata.goog',
]);

type AddressClass = 'public' | 'private' | 'loopback' | 'link-local' | 'metadata' | 'invalid';
type EgressHostResolver = (host: string) => Promise<string[]>;
export interface ResolvedEgressDecision {
  decision: RunEgressDecision;
  resolvedAddresses: string[];
}

export class EgressPolicyService {
  constructor(
    private readonly resolveHost: EgressHostResolver = async (host) =>
      (await lookup(host, { all: true, verbatim: true })).map((record) => record.address)
  ) {}

  compile(rules: SandboxNetworkRules): RunEgressPolicy {
    const allowedHosts = compileHostRules(
      rules.allowedHosts,
      Boolean(rules.dangerouslyAllowGlobalWildcard),
      'allow'
    );
    const deniedHosts = compileHostRules(rules.deniedHosts ?? [], true, 'deny');
    const payload: Omit<RunEgressPolicy, 'policyHash'> = {
      schemaVersion: RUN_EGRESS_POLICY_SCHEMA_VERSION,
      defaultEgress: rules.defaultEgress,
      allowedHosts,
      deniedHosts,
      allowedMethods: uniqueSorted(rules.allowedMethods.map((method) => method.toUpperCase())),
      allowedPathPrefixes: normalizePathPrefixes(rules.allowedPathPrefixes),
      blockPrivateNetwork: rules.blockPrivateNetwork,
      blockMetadataEndpoints: rules.blockMetadataEndpoints,
      blockLoopback: rules.blockLoopback,
      allowApprovals: rules.allowApprovals ?? false,
      tlsInspection: 'disabled',
    };
    return {
      ...payload,
      policyHash: digestRunLaunchValue(payload),
    };
  }

  evaluate(policy: RunEgressPolicy, input: RunEgressDecisionInput): RunEgressDecision {
    const host = normalizeHost(input.host);
    const method = input.method?.trim().toUpperCase();
    const base = {
      schemaVersion: RUN_EGRESS_DECISION_SCHEMA_VERSION,
      policyHash: policy.policyHash,
      protocol: input.protocol,
      hostKey: identity('egress-host', host || input.host),
      port: input.port,
      ...(method ? { method } : {}),
    } as const;
    if (!host || !Number.isInteger(input.port) || input.port < 1 || input.port > 65_535) {
      return blocked(base, policy, 'invalid-destination');
    }
    if (input.resolvedAddresses?.some((address) => isIP(address) === 0)) {
      return blocked(base, policy, 'invalid-destination');
    }

    const deniedRule = matchingHostRule(policy.deniedHosts, host);
    if (deniedRule) {
      return blocked(base, policy, 'denied-host', { matchedRule: deniedRule });
    }
    const allowedRule = matchingHostRule(policy.allowedHosts, host);
    if (policy.defaultEgress === 'deny' && !allowedRule) {
      return blocked(base, policy, 'default-deny');
    }

    const addressBlock = destinationAddressBlock(policy, host, input.resolvedAddresses ?? []);
    if (addressBlock) {
      return blocked(base, policy, addressBlock.reason, {
        blockedAddressClass: addressBlock.addressClass,
        ...(allowedRule ? { matchedRule: allowedRule } : {}),
      });
    }

    const inspectionRequired =
      (input.protocol === 'https' || input.protocol === 'wss' || input.protocol === 'socks') &&
      !input.tlsInspected &&
      (policy.allowedMethods.length > 0 || hasPathRestriction(policy.allowedPathPrefixes));
    if (inspectionRequired) {
      return blocked(base, policy, 'tls-inspection-required', {
        ...(allowedRule ? { matchedRule: allowedRule } : {}),
      });
    }
    if (policy.allowedMethods.length > 0 && (!method || !policy.allowedMethods.includes(method))) {
      return blocked(base, policy, 'method-not-allowed', {
        ...(allowedRule ? { matchedRule: allowedRule } : {}),
      });
    }
    if (
      hasPathRestriction(policy.allowedPathPrefixes) &&
      !pathAllowed(input.path, policy.allowedPathPrefixes)
    ) {
      return blocked(base, policy, 'path-not-allowed', {
        ...(allowedRule ? { matchedRule: allowedRule } : {}),
      });
    }

    return {
      ...base,
      decision: 'allow',
      reason: allowedRule ? 'allowed-by-host-rule' : 'allowed-by-default',
      ...(allowedRule ? { matchedRule: allowedRule } : {}),
      approvalEligible: false,
    };
  }

  async evaluateResolved(
    policy: RunEgressPolicy,
    input: Omit<RunEgressDecisionInput, 'resolvedAddresses'>
  ): Promise<RunEgressDecision> {
    return (await this.resolveAndEvaluate(policy, input)).decision;
  }

  async resolveAndEvaluate(
    policy: RunEgressPolicy,
    input: Omit<RunEgressDecisionInput, 'resolvedAddresses'>
  ): Promise<ResolvedEgressDecision> {
    const host = normalizeHost(input.host);
    try {
      const resolvedAddresses = isIP(host) === 0 ? await this.resolveHost(host) : [host];
      return {
        decision: this.evaluate(policy, { ...input, resolvedAddresses }),
        resolvedAddresses,
      };
    } catch {
      return {
        decision: this.evaluate(policy, { ...input, resolvedAddresses: ['unresolved'] }),
        resolvedAddresses: [],
      };
    }
  }
}

function compileHostRules(
  values: string[],
  allowGlobalWildcard: boolean,
  list: 'allow' | 'deny'
): RunEgressHostRule[] {
  const byIdentity = new Map<string, RunEgressHostRule>();
  for (const rawValue of values) {
    const value = rawValue.trim().toLowerCase();
    let rule: RunEgressHostRule;
    if (value === '*') {
      if (!allowGlobalWildcard) {
        throw new ValidationError(
          'A global egress allow wildcard requires dangerouslyAllowGlobalWildcard.',
          { list, rule: '*' }
        );
      }
      rule = { kind: 'any', value: '*' };
    } else if (value.startsWith('*.')) {
      const base = normalizeHost(value.slice(2));
      if (!base || isIP(base) !== 0 || !base.includes('.')) {
        throw invalidHostRule(list, rawValue);
      }
      rule = { kind: 'subdomain', value: base };
    } else {
      if (value.includes('*')) throw invalidHostRule(list, rawValue);
      const host = normalizeHost(value);
      if (!host) throw invalidHostRule(list, rawValue);
      rule = { kind: 'exact', value: host };
    }
    byIdentity.set(`${rule.kind}:${rule.value}`, rule);
  }
  return [...byIdentity.values()].sort(
    (left, right) => left.kind.localeCompare(right.kind) || left.value.localeCompare(right.value)
  );
}

function invalidHostRule(list: 'allow' | 'deny', rule: string): ValidationError {
  return new ValidationError(
    'Egress host rules must be exact hosts or scoped *.example.com rules.',
    {
      list,
      rule,
    }
  );
}

function normalizeHost(value: string): string {
  const unwrapped = value
    .trim()
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '')
    .toLowerCase();
  if (!unwrapped) return '';
  if (isIP(unwrapped) !== 0) return unwrapped;
  const ascii = domainToASCII(unwrapped);
  if (
    !ascii ||
    ascii.length > 253 ||
    ascii.split('.').some((label) => !label || label.length > 63)
  ) {
    return '';
  }
  return ascii.toLowerCase();
}

function normalizePathPrefixes(values: string[]): string[] {
  const normalized = values.map((value) => {
    const path = value.trim().split(/[?#]/, 1)[0] ?? '';
    if (!path.startsWith('/')) {
      throw new ValidationError('Egress path prefixes must start with /.', { path: value });
    }
    return path.length > 1 ? path.replace(/\/+$/, '') : path;
  });
  return uniqueSorted(normalized);
}

function matchingHostRule(rules: RunEgressHostRule[], host: string): RunEgressHostRule | undefined {
  return rules.find(
    (rule) =>
      rule.kind === 'any' ||
      (rule.kind === 'exact' && rule.value === host) ||
      (rule.kind === 'subdomain' && host.endsWith(`.${rule.value}`))
  );
}

function destinationAddressBlock(
  policy: RunEgressPolicy,
  host: string,
  resolvedAddresses: string[]
):
  | {
      reason: 'private-network-blocked' | 'loopback-blocked' | 'metadata-endpoint-blocked';
      addressClass: Exclude<AddressClass, 'public' | 'invalid'>;
    }
  | undefined {
  const candidates = isIP(host) !== 0 ? [host, ...resolvedAddresses] : resolvedAddresses;
  if (policy.blockMetadataEndpoints && METADATA_HOSTS.has(host)) {
    return { reason: 'metadata-endpoint-blocked', addressClass: 'metadata' };
  }
  for (const address of candidates) {
    const addressClass = classifyAddress(address);
    if (policy.blockMetadataEndpoints && addressClass === 'metadata') {
      return { reason: 'metadata-endpoint-blocked', addressClass };
    }
    if (policy.blockLoopback && addressClass === 'loopback') {
      return { reason: 'loopback-blocked', addressClass };
    }
    if (
      policy.blockPrivateNetwork &&
      (addressClass === 'private' || addressClass === 'link-local')
    ) {
      return { reason: 'private-network-blocked', addressClass };
    }
  }
  return undefined;
}

function classifyAddress(value: string): AddressClass {
  const address = value
    .trim()
    .replace(/^\[|\]$/g, '')
    .toLowerCase();
  if (METADATA_HOSTS.has(address)) return 'metadata';
  if (address.startsWith('::ffff:')) return classifyAddress(address.slice('::ffff:'.length));
  const family = isIP(address);
  if (family === 4) {
    const octets = address.split('.').map(Number);
    const [first = -1, second = -1] = octets;
    if (first === 127 || first === 0) return 'loopback';
    if (first === 169 && second === 254) return 'link-local';
    if (
      first === 10 ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && second === 168) ||
      (first === 100 && second >= 64 && second <= 127)
    ) {
      return 'private';
    }
    return 'public';
  }
  if (family === 6) {
    if (address === '::1' || address === '::') return 'loopback';
    const first = Number.parseInt(address.split(':', 1)[0] || '0', 16);
    if ((first & 0xfe00) === 0xfc00) return 'private';
    if ((first & 0xffc0) === 0xfe80) return 'link-local';
    return 'public';
  }
  return 'invalid';
}

function hasPathRestriction(prefixes: string[]): boolean {
  return prefixes.length > 0 && !prefixes.includes('/');
}

function pathAllowed(value: string | undefined, prefixes: string[]): boolean {
  if (!value) return false;
  const path = value.split(/[?#]/, 1)[0] || '/';
  return prefixes.some(
    (prefix) =>
      prefix === '/' ||
      path === prefix ||
      (path.startsWith(prefix) && (prefix.endsWith('/') || path[prefix.length] === '/'))
  );
}

function blocked(
  base: Pick<
    RunEgressDecision,
    'schemaVersion' | 'policyHash' | 'protocol' | 'hostKey' | 'port' | 'method'
  >,
  policy: RunEgressPolicy,
  reason: RunEgressDecisionReason,
  evidence: Pick<RunEgressDecision, 'matchedRule' | 'blockedAddressClass'> = {}
): RunEgressDecision {
  const approvalEligible =
    policy.allowApprovals &&
    ['default-deny', 'method-not-allowed', 'path-not-allowed', 'tls-inspection-required'].includes(
      reason
    );
  return {
    ...base,
    decision: 'block',
    reason,
    ...evidence,
    approvalEligible,
  };
}

function identity(kind: string, value: string): string {
  return `sha256:${createHash('sha256').update(`${kind}:${value}`).digest('hex')}`;
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

let service: EgressPolicyService | undefined;

export function getEgressPolicyService(): EgressPolicyService {
  service ??= new EgressPolicyService();
  return service;
}
