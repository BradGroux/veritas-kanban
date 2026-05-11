export interface AgentRequest {
  taskId: string;
  attemptId: string;
  prompt: string;
  requestedAt: string;
  callbackUrl?: string;
  provider?: string;
  model?: string;
  source?: 'veritas-runnable-claim';
}

export interface DispatchResult {
  taskId: string;
  attemptId: string;
  source: AgentRequest['source'];
  status: 'failed';
  exitCode?: number;
  summary?: string;
  error?: string;
}

type ApiOptions = {
  method?: string;
  body?: string;
  headers?: Record<string, string>;
};

export type ApiClient = <T>(apiPath: string, options?: ApiOptions) => Promise<T>;

export interface ProcessResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export type ProcessRunner = (
  command: string,
  args: string[],
  options: { cwd?: string; timeoutMs: number }
) => Promise<ProcessResult>;

export interface DispatchOptions {
  source?: 'veritas-runnable-claim';
  requestsDir?: never;
  hermesCommand?: string;
  toolsets?: string;
  provider?: string;
  model?: string;
  limit?: number;
  dryRun?: boolean;
  timeoutMs?: number;
  apiBase?: string;
}

export const DEFAULT_VERITAS_API_BASE = 'http://127.0.0.1:3099';

const RETIRED_MESSAGE =
  'Legacy CLI pending/request-file dispatch is retired. Use Veritas runnable/claim APIs and HermesAgent /v1/runs; do not poll retired pending routes or local request directories.';

export async function loadPendingAgentRequests(): Promise<AgentRequest[]> {
  throw new Error(RETIRED_MESSAGE);
}

export async function dispatchPendingToHermes(): Promise<DispatchResult[]> {
  throw new Error(RETIRED_MESSAGE);
}

export async function dispatchAgentRequest(): Promise<DispatchResult> {
  throw new Error(RETIRED_MESSAGE);
}

export function buildHermesArgs(): string[] {
  throw new Error(RETIRED_MESSAGE);
}

export function buildHermesPrompt(): string {
  throw new Error(RETIRED_MESSAGE);
}

export function resolveHermesRoute(
  _request: Pick<AgentRequest, 'provider' | 'model'> = {},
  options: Pick<DispatchOptions, 'provider' | 'model'> = {}
): { provider: string; model: string } {
  return {
    provider: options.provider || 'openai-codex',
    model: options.model || 'gpt-5.5',
  };
}

export function parseWorktreeFromPrompt(_prompt: string): string | undefined {
  return undefined;
}

export function summarizeHermesOutput(stdout: string, stderr = ''): string {
  return (stdout || stderr || '').trim();
}
