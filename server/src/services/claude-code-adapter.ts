import type { SandboxPolicyDryRunResult } from '@veritas-kanban/shared';

export const CLAUDE_CODE_CERTIFIED_VERSION = '2.1.218 (Claude Code)';
export const CLAUDE_CODE_PROTOCOL_VERSION = 'claude-code-stream-json/v1';

export const CLAUDE_CODE_MAX_STREAM_RECORD_BYTES = 1024 * 1024;
const DEFAULT_MAX_TURNS = 100;
const MAX_CONFIGURED_TURNS = 1_000;
const MAX_SUMMARY_LENGTH = 8_000;

const BASE_ENVIRONMENT_ALLOWLIST = new Set([
  'CI',
  'FORCE_COLOR',
  'HOME',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'LOGNAME',
  'NODE_EXTRA_CA_CERTS',
  'NO_COLOR',
  'PATH',
  'SHELL',
  'SSL_CERT_FILE',
  'TEMP',
  'TERM',
  'TMP',
  'TMPDIR',
  'USER',
  'VK_API_URL',
]);

export const CLAUDE_CODE_CREDENTIAL_ENV_KEYS = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_FOUNDRY_API_KEY',
  'ANTHROPIC_FOUNDRY_AUTH_TOKEN',
  'AWS_ACCESS_KEY_ID',
  'AWS_BEARER_TOKEN_BEDROCK',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_SESSION_TOKEN',
] as const;

export const CLAUDE_CODE_ENVIRONMENT_KEYS = [
  'ANTHROPIC_BEDROCK_BASE_URL',
  'ANTHROPIC_FOUNDRY_BASE_URL',
  'ANTHROPIC_FOUNDRY_RESOURCE',
  'ANTHROPIC_VERTEX_BASE_URL',
  'ANTHROPIC_VERTEX_PROJECT_ID',
  'AWS_DEFAULT_REGION',
  'AWS_PROFILE',
  'AWS_REGION',
  'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_FOUNDRY',
  'CLAUDE_CODE_USE_VERTEX',
  'CLOUD_ML_REGION',
  'GOOGLE_APPLICATION_CREDENTIALS',
  'GOOGLE_CLOUD_PROJECT',
] as const;

const EXPLICIT_CREDENTIAL_KEYS = new Set<string>(CLAUDE_CODE_CREDENTIAL_ENV_KEYS);
const EXPLICIT_ENVIRONMENT_KEYS = new Set<string>(CLAUDE_CODE_ENVIRONMENT_KEYS);
const SECRET_ENV_KEY_PATTERN =
  /(?:SECRET|TOKEN|PASSWORD|PASS|CREDENTIAL|COOKIE|SESSION|WEBHOOK|DATABASE|DB_URL|PRIVATE|SERVICE_ROLE|ADMIN_KEY|API_KEYS?|GITHUB|GH_|SUPABASE|STRIPE|AZURE_|GCP_)/i;

const CONTROLLED_OR_UNSAFE_FLAGS = new Set([
  '--add-dir',
  '--agent',
  '--agents',
  '--allow-dangerously-skip-permissions',
  '--allowed-tools',
  '--allowedTools',
  '--append-system-prompt-file',
  '--bare',
  '--continue',
  '--dangerously-skip-permissions',
  '--disable-slash-commands',
  '--disallowed-tools',
  '--disallowedTools',
  '--fork-session',
  '--include-hook-events',
  '--include-partial-messages',
  '--input-format',
  '--json-schema',
  '--mcp-config',
  '--model',
  '--no-chrome',
  '--output-format',
  '--permission-mode',
  '--permission-prompt-tool',
  '--plugin-dir',
  '--plugin-url',
  '--print',
  '--replay-user-messages',
  '--resume',
  '--safe-mode',
  '--session-id',
  '--setting-sources',
  '--settings',
  '--strict-mcp-config',
  '--system-prompt',
  '--system-prompt-file',
  '--tools',
  '--verbose',
]);

export interface ClaudeCodeLaunchInput {
  prompt: string;
  model?: string;
  extraArgs?: string[];
  sandboxMode: SandboxPolicyDryRunResult['effective']['sandboxMode'];
  networkAccessEnabled: boolean;
  maxBudgetUsd?: number;
}

export interface ClaudeCodeUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cost?: number;
  model?: string;
}

export interface ClaudeCodeTerminalResult {
  success: boolean;
  summary?: string;
  error?: string;
  subtype: string;
}

export interface ClaudeCodeStreamClassification {
  providerType: string;
  summary?: string;
  sessionId?: string;
  parentToolUseId?: string;
  tool?: string;
  files: string[];
  usage?: ClaudeCodeUsage;
  terminal?: ClaudeCodeTerminalResult;
}

export function buildSafeClaudeCodeEnv(
  source: NodeJS.ProcessEnv = process.env,
  passthroughKeys?: Iterable<string>
): Record<string, string> {
  const allowlist = new Set(BASE_ENVIRONMENT_ALLOWLIST);
  for (const key of EXPLICIT_CREDENTIAL_KEYS) allowlist.add(key);
  for (const key of EXPLICIT_ENVIRONMENT_KEYS) allowlist.add(key);
  if (passthroughKeys) {
    for (const key of passthroughKeys) allowlist.add(key.toUpperCase());
  }

  const env: Record<string, string> = {};
  for (const key of allowlist) {
    const value = source[key];
    if (typeof value !== 'string') continue;
    if (
      SECRET_ENV_KEY_PATTERN.test(key) &&
      !EXPLICIT_CREDENTIAL_KEYS.has(key) &&
      !EXPLICIT_ENVIRONMENT_KEYS.has(key)
    ) {
      continue;
    }
    env[key] = value;
  }
  env.VK_API_URL = source.VK_API_URL || 'http://localhost:3001';
  env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = '1';
  env.CLAUDE_CODE_SUBPROCESS_ENV_SCRUB = '1';
  return env;
}

export function hasClaudeCodeBareAuthentication(source: NodeJS.ProcessEnv = process.env): boolean {
  if (source.ANTHROPIC_API_KEY || source.ANTHROPIC_AUTH_TOKEN) return true;
  if (
    enabledEnvironmentFlag(source.CLAUDE_CODE_USE_BEDROCK) &&
    (source.AWS_BEARER_TOKEN_BEDROCK ||
      source.AWS_PROFILE ||
      (source.AWS_ACCESS_KEY_ID && source.AWS_SECRET_ACCESS_KEY))
  ) {
    return true;
  }
  if (
    enabledEnvironmentFlag(source.CLAUDE_CODE_USE_VERTEX) &&
    source.GOOGLE_APPLICATION_CREDENTIALS
  ) {
    return true;
  }
  return Boolean(
    enabledEnvironmentFlag(source.CLAUDE_CODE_USE_FOUNDRY) &&
    (source.ANTHROPIC_FOUNDRY_API_KEY || source.ANTHROPIC_FOUNDRY_AUTH_TOKEN)
  );
}

function enabledEnvironmentFlag(value: string | undefined): boolean {
  return value === '1' || value?.toLowerCase() === 'true';
}

export function buildClaudeCodeArgs(input: ClaudeCodeLaunchInput): string[] {
  const normalizedExtras = normalizeExtraArgs(input.extraArgs ?? []);
  const configuredMaxTurns = readConfiguredMaxTurns(normalizedExtras);
  const extraArgs = removeFlagAndValue(normalizedExtras, '--max-turns');
  const writable = input.sandboxMode !== 'read-only';
  const allowedTools = ['Read', 'Glob', 'Grep', ...(writable ? ['Edit', 'Write'] : [])];
  if (writable && input.networkAccessEnabled) allowedTools.push('Bash');
  const deniedTools = [
    'Read(.env)',
    'Read(.env.*)',
    'Read(**/.env)',
    'Read(**/.env.*)',
    'Read(**/*secret*)',
    'Read(**/*credential*)',
    ...(!input.networkAccessEnabled ? ['WebFetch', 'WebSearch'] : []),
  ];
  const args = [
    '--bare',
    '--print',
    '--output-format',
    'stream-json',
    '--verbose',
    '--include-partial-messages',
    '--include-hook-events',
    '--forward-subagent-text',
    '--disable-slash-commands',
    '--no-chrome',
    '--permission-mode',
    'dontAsk',
    '--allowedTools',
    allowedTools.join(','),
    '--disallowedTools',
    deniedTools.join(','),
    '--max-turns',
    String(configuredMaxTurns ?? DEFAULT_MAX_TURNS),
    ...extraArgs,
  ];
  if (input.maxBudgetUsd !== undefined) {
    if (!Number.isFinite(input.maxBudgetUsd) || input.maxBudgetUsd <= 0) {
      throw new Error('Claude Code maximum budget must be a positive finite number.');
    }
    args.push('--max-budget-usd', String(input.maxBudgetUsd));
  }
  if (input.model?.trim()) args.push('--model', input.model.trim());
  args.push(input.prompt);
  return args;
}

function normalizeExtraArgs(args: string[]): string[] {
  const normalized: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (
      CONTROLLED_OR_UNSAFE_FLAGS.has(flag) ||
      [...CONTROLLED_OR_UNSAFE_FLAGS].some((candidate) => flag.startsWith(`${candidate}=`))
    ) {
      if (flag === '--permission-prompt-tool' || flag.startsWith('--permission-prompt-tool=')) {
        throw new Error(
          'Claude Code permission prompt routing is unavailable until the Veritas approval and MCP brokers are active.'
        );
      }
      throw new Error(`Claude Code launch argument "${flag}" is controlled or not allowed.`);
    }
    if (!['--effort', '--fallback-model', '--betas', '--max-turns', '--name'].includes(flag)) {
      throw new Error(`Claude Code launch argument "${flag}" is not allowed.`);
    }
    const value = args[index + 1];
    if (!value || value.startsWith('--')) {
      throw new Error(`Claude Code launch argument "${flag}" requires a value.`);
    }
    if (flag === '--effort' && !['low', 'medium', 'high', 'xhigh', 'max'].includes(value)) {
      throw new Error(`Claude Code effort "${value}" is not supported.`);
    }
    if (flag === '--max-turns') {
      const turns = Number(value);
      if (!Number.isInteger(turns) || turns < 1 || turns > MAX_CONFIGURED_TURNS) {
        throw new Error(
          `Claude Code max turns must be an integer between 1 and ${MAX_CONFIGURED_TURNS}.`
        );
      }
    }
    if (Buffer.byteLength(value, 'utf8') > 500) {
      throw new Error(`Claude Code launch argument "${flag}" exceeds the bounded value limit.`);
    }
    normalized.push(flag, value);
    index += 1;
  }
  return normalized;
}

function readConfiguredMaxTurns(args: string[]): number | undefined {
  const index = args.indexOf('--max-turns');
  return index >= 0 ? Number(args[index + 1]) : undefined;
}

function removeFlagAndValue(args: string[], flag: string): string[] {
  const filtered: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === flag) {
      index += 1;
      continue;
    }
    filtered.push(args[index]);
  }
  return filtered;
}

export function parseClaudeCodeStreamLine(line: string): Record<string, unknown> {
  const trimmed = line.trim();
  if (!trimmed) throw new Error('Claude Code stream record was empty.');
  if (Buffer.byteLength(trimmed, 'utf8') > CLAUDE_CODE_MAX_STREAM_RECORD_BYTES) {
    throw new Error('Claude Code stream record exceeded the 1 MiB safety limit.');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (error) {
    throw new Error('Claude Code stream record was not valid JSON.', { cause: error });
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Claude Code stream record must be a JSON object.');
  }
  const record = parsed as Record<string, unknown>;
  if (typeof record.type !== 'string' || !record.type.trim()) {
    throw new Error('Claude Code stream record is missing its type.');
  }
  return record;
}

export function classifyClaudeCodeStreamRecord(
  record: Record<string, unknown>
): ClaudeCodeStreamClassification {
  const type = boundedIdentifier(record.type) ?? 'unknown';
  const subtype = boundedIdentifier(record.subtype);
  const sessionId = boundedIdentifier(record.session_id);
  const parentToolUseId = boundedIdentifier(record.parent_tool_use_id);
  const content = messageContent(record);
  const toolUse = content.find((entry) => stringValue(entry.type) === 'tool_use');
  const toolResult = content.find((entry) => stringValue(entry.type) === 'tool_result');
  const streamEvent = recordValue(record.event);
  const delta = recordValue(streamEvent?.delta);
  const deltaType = stringValue(delta?.type);
  const streamType = stringValue(streamEvent?.type);
  const textBlocks = content
    .filter((entry) => stringValue(entry.type) === 'text')
    .map((entry) => stringValue(entry.text))
    .filter((value): value is string => Boolean(value));
  const deltaText = stringValue(delta?.text) ?? stringValue(delta?.thinking);
  const resultText = stringValue(record.result);
  const providerType =
    type === 'stream_event'
      ? [type, streamType, deltaType].filter(Boolean).join('.')
      : type === 'assistant' && toolUse
        ? 'assistant.tool_use'
        : type === 'assistant' && parentToolUseId
          ? 'assistant.subagent'
          : type === 'user' && toolResult
            ? 'user.tool_result'
            : [type, subtype].filter(Boolean).join('.');
  const messageText = textBlocks.length > 0 ? textBlocks.join('\n') : undefined;
  const summary = boundedSummary(
    deltaText ?? messageText ?? resultText ?? systemSummary(record, subtype) ?? undefined
  );
  const usage = extractClaudeCodeUsage(record);
  const terminal =
    type === 'result' ? terminalResult(record, subtype ?? 'unknown', resultText) : undefined;

  return {
    providerType,
    ...(summary ? { summary } : {}),
    ...(sessionId ? { sessionId } : {}),
    ...(parentToolUseId ? { parentToolUseId } : {}),
    ...(toolUse && boundedIdentifier(toolUse.name)
      ? { tool: boundedIdentifier(toolUse.name) }
      : {}),
    files: extractClaudeCodeFiles(content),
    ...(usage ? { usage } : {}),
    ...(terminal ? { terminal } : {}),
  };
}

function extractClaudeCodeUsage(record: Record<string, unknown>): ClaudeCodeUsage | undefined {
  const usage = recordValue(record.usage);
  if (!usage) return undefined;
  const inputTokens = finiteNumber(usage.input_tokens) ?? finiteNumber(usage.inputTokens) ?? 0;
  const outputTokens = finiteNumber(usage.output_tokens) ?? finiteNumber(usage.outputTokens) ?? 0;
  const totalTokens =
    finiteNumber(usage.total_tokens) ??
    finiteNumber(usage.totalTokens) ??
    inputTokens + outputTokens;
  const cost = finiteNumber(record.total_cost_usd) ?? finiteNumber(record.totalCostUsd);
  const model = stringValue(record.model);
  return {
    inputTokens,
    outputTokens,
    totalTokens,
    ...(cost !== undefined ? { cost } : {}),
    ...(model ? { model } : {}),
  };
}

function terminalResult(
  record: Record<string, unknown>,
  subtype: string,
  resultText: string | undefined
): ClaudeCodeTerminalResult {
  const success = subtype === 'success' && record.is_error !== true;
  const fallbackError =
    stringValue(record.error) ??
    stringValue(record.message) ??
    (!success ? `Claude Code returned terminal result ${subtype}.` : undefined);
  return {
    success,
    ...(resultText ? { summary: boundedSummary(resultText) } : {}),
    ...(!success && fallbackError ? { error: boundedSummary(fallbackError) } : {}),
    subtype,
  };
}

function extractClaudeCodeFiles(content: Array<Record<string, unknown>>): string[] {
  const files = new Set<string>();
  for (const block of content) {
    if (stringValue(block.type) !== 'tool_use') continue;
    const input = recordValue(block.input);
    for (const key of ['file_path', 'path', 'notebook_path']) {
      const candidate = boundedIdentifier(input?.[key], 2_048);
      if (candidate) files.add(candidate);
    }
  }
  return [...files].slice(0, 20);
}

function messageContent(record: Record<string, unknown>): Array<Record<string, unknown>> {
  const message = recordValue(record.message);
  const content = message?.content;
  if (!Array.isArray(content)) return [];
  return content
    .filter((entry): entry is Record<string, unknown> =>
      Boolean(entry && typeof entry === 'object' && !Array.isArray(entry))
    )
    .slice(0, 200);
}

function systemSummary(
  record: Record<string, unknown>,
  subtype: string | undefined
): string | undefined {
  if (!subtype) return undefined;
  if (subtype === 'api_retry') {
    const attempt = finiteNumber(record.attempt);
    const maxRetries = finiteNumber(record.max_retries);
    return `Claude Code API retry${attempt !== undefined ? ` ${attempt}` : ''}${
      maxRetries !== undefined ? ` of ${maxRetries}` : ''
    }.`;
  }
  const hook = stringValue(record.hook_name);
  return hook ? `${subtype}: ${hook}` : subtype;
}

function boundedSummary(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  if (!normalized) return undefined;
  return normalized.length > MAX_SUMMARY_LENGTH
    ? `${normalized.slice(0, MAX_SUMMARY_LENGTH)}[truncated]`
    : normalized;
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function boundedIdentifier(value: unknown, maxLength = 256): string | undefined {
  const normalized = stringValue(value);
  const containsControlCharacter = [...(normalized ?? '')].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 31 || codePoint === 127;
  });
  if (!normalized || normalized.length > maxLength || containsControlCharacter) {
    return undefined;
  }
  return normalized;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= Number.MAX_SAFE_INTEGER
    ? value
    : undefined;
}
