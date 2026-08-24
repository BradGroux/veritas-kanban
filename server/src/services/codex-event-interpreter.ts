import type { AgentRunTraceStepType } from '@veritas-kanban/shared';

const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]'],
  [/\bsk-[A-Za-z0-9_-]{12,}/g, 'sk-[REDACTED]'],
  [/\bghp_[A-Za-z0-9_]{12,}/g, 'ghp_[REDACTED]'],
  [/\bgithub_pat_[A-Za-z0-9_]{12,}/g, 'github_pat_[REDACTED]'],
  [
    /\b([A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|API_KEY|ACCESS_KEY)[A-Z0-9_]*)\s*=\s*([^\s"'`]+)/gi,
    '$1=[REDACTED]',
  ],
  [/\b(api[_-]?key|token|secret|password|authorization)\s*[:=]\s*([^\s"'`,}]+)/gi, '$1=[REDACTED]'],
];

const SUMMARY_KEYS = [
  'final_response',
  'finalMessage',
  'final_message',
  'message',
  'text',
  'delta',
  'chunk',
  'content',
  'output',
];
const FILE_KEYS = new Set([
  'file',
  'file_path',
  'filePath',
  'path',
  'relative_path',
  'relativePath',
  'absolute_path',
  'absolutePath',
]);

export interface CodexEventUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens?: number;
  cost?: number;
  model?: string;
}

export interface CodexEventInterpretation {
  summary?: string;
  usage?: CodexEventUsage;
  files: string[];
  command?: string;
  tool?: string;
  error?: string;
  traceStepType: AgentRunTraceStepType;
  stream?: 'stdout' | 'stderr';
  retryAttempt?: number;
  retryDelayMs?: number;
  logActivity: boolean;
}

export function redactProviderTraceText(value: string): string {
  let redacted = value;
  for (const [pattern, replacement] of SECRET_PATTERNS) {
    redacted = redacted.replace(pattern, replacement);
  }
  return redacted.length > 2000 ? `${redacted.slice(0, 2000)}...` : redacted;
}

export function interpretCodexEvent(
  event: Record<string, unknown>,
  type: string
): CodexEventInterpretation {
  const command = findString(event, new Set(['command', 'cmd', 'shell_command', 'shellCommand']));
  const args = findStringArray(event, new Set(['args', 'argv']));
  const tool =
    findString(
      event,
      new Set(['tool', 'tool_name', 'toolName', 'function_name', 'functionName'])
    ) ??
    itemType(event) ??
    type;
  return {
    summary: extractSummary(event),
    usage: extractUsage(event),
    files: extractFiles(event),
    command: command
      ? `${command}${args.length ? ` ${args.join(' ')}` : ''}`
      : args.join(' ') || undefined,
    tool,
    error:
      type.includes('failed') || type === 'error'
        ? findString(event, new Set(['error', 'message']))
        : undefined,
    traceStepType: traceStepType(type, event),
    stream: extractStream(event, type),
    retryAttempt: findNumber(event, new Set(['retryAttempt', 'retry_attempt', 'attempt'])),
    retryDelayMs: findNumber(event, new Set(['retryDelayMs', 'retry_delay_ms', 'delayMs'])),
    logActivity: /command|tool|file|retry|abort|completed|failed/.test(type) || type === 'error',
  };
}

function visitRecords(
  value: unknown,
  visitor: (record: Record<string, unknown>) => boolean | void,
  seen = new Set<unknown>()
): void {
  if (!value || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  if (visitor(value as Record<string, unknown>)) return;
  for (const child of Object.values(value as Record<string, unknown>)) {
    visitRecords(child, visitor, seen);
  }
}

function findString(value: unknown, keys: Set<string>): string | undefined {
  let found: string | undefined;
  visitRecords(value, (record) => {
    for (const [key, candidate] of Object.entries(record)) {
      if (keys.has(key) && typeof candidate === 'string' && candidate.trim()) {
        found = candidate.trim();
        return true;
      }
    }
    return false;
  });
  return found;
}

function findStringArray(value: unknown, keys: Set<string>): string[] {
  let found: string[] = [];
  visitRecords(value, (record) => {
    for (const [key, candidate] of Object.entries(record)) {
      if (keys.has(key) && Array.isArray(candidate)) {
        const strings = candidate
          .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
          .map((item) => item.trim())
          .slice(0, 20);
        if (strings.length) {
          found = strings;
          return true;
        }
      }
    }
    return false;
  });
  return found;
}

function findNumber(value: unknown, keys: Set<string>): number | undefined {
  let found: number | undefined;
  visitRecords(value, (record) => {
    for (const [key, candidate] of Object.entries(record)) {
      if (!keys.has(key)) continue;
      if (typeof candidate !== 'number' && typeof candidate !== 'string') continue;
      const parsed = typeof candidate === 'number' ? candidate : Number(candidate);
      if (Number.isFinite(parsed)) {
        found = parsed;
        return true;
      }
    }
    return false;
  });
  return found;
}

function extractFiles(value: unknown): string[] {
  const files = new Set<string>();
  visitRecords(value, (record) => {
    for (const [key, candidate] of Object.entries(record)) {
      if (FILE_KEYS.has(key) && typeof candidate === 'string' && looksLikeFilePath(candidate)) {
        files.add(candidate);
      }
      if (FILE_KEYS.has(key) && Array.isArray(candidate)) {
        for (const item of candidate) {
          if (typeof item === 'string' && looksLikeFilePath(item)) files.add(item);
        }
      }
    }
  });
  return [...files].slice(0, 25);
}

function extractUsage(value: unknown): CodexEventUsage | undefined {
  let usage: CodexEventUsage | undefined;
  visitRecords(value, (record) => {
    const input =
      record.input_tokens ?? record.inputTokens ?? record.prompt_tokens ?? record.promptTokens;
    const output =
      record.output_tokens ??
      record.outputTokens ??
      record.completion_tokens ??
      record.completionTokens;
    if (typeof input !== 'number' || typeof output !== 'number') return false;
    const total = record.total_tokens ?? record.totalTokens;
    const cost = record.cost ?? record.cost_usd ?? record.costUsd;
    usage = {
      inputTokens: input,
      outputTokens: output,
      totalTokens: typeof total === 'number' ? total : input + output,
      cost: typeof cost === 'number' ? cost : undefined,
      model: typeof record.model === 'string' ? record.model : undefined,
    };
    return true;
  });
  return usage;
}

function traceStepType(type: string, event: Record<string, unknown>): AgentRunTraceStepType {
  const normalized = type.toLowerCase();
  if (normalized.includes('retry')) return 'retry';
  if (normalized.includes('abort') || normalized.includes('cancel')) return 'abort';
  if (normalized.includes('failed') || normalized === 'error') return 'error';
  if (normalized.includes('finaliz')) return 'finalize';
  if (/delta|stream|output|stdout|stderr/.test(normalized)) return 'stream';
  if (/delta|message_delta/.test((itemType(event) ?? '').toLowerCase())) return 'stream';
  if (type === 'turn.completed' || type === 'response.completed') return 'complete';
  return 'execute';
}

function itemType(event: Record<string, unknown>): string | undefined {
  if (!event.item || typeof event.item !== 'object') return undefined;
  const type = (event.item as Record<string, unknown>).type;
  return typeof type === 'string' && type.trim() ? type.trim() : undefined;
}

function extractSummary(value: unknown): string | undefined {
  let summary: string | undefined;
  visitRecords(value, (record) => {
    for (const key of SUMMARY_KEYS) {
      const candidate = record[key];
      if (typeof candidate === 'string' && candidate.trim()) {
        summary = candidate.trim();
        return true;
      }
    }
    return false;
  });
  return summary;
}

function extractStream(
  event: Record<string, unknown>,
  type: string
): 'stdout' | 'stderr' | undefined {
  const stream = findString(event, new Set(['stream', 'channel', 'fd']));
  if (stream === 'stdout' || stream === 'stderr') return stream;
  if (/stderr|error/i.test(type)) return 'stderr';
  if (/stdout|delta|output|stream/i.test(type)) return 'stdout';
  return undefined;
}

function looksLikeFilePath(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed || trimmed.includes('\n')) return false;
  if (/^https?:\/\//i.test(trimmed)) return true;
  if (trimmed.startsWith('/') || trimmed.startsWith('./') || trimmed.startsWith('../')) return true;
  return /^[\w.-]+\/[\w./-]+$/.test(trimmed) || /\.[a-z0-9]{1,12}$/i.test(trimmed);
}
