import { Command } from 'commander';
import chalk from 'chalk';
import { execFile } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { API_BASE, buildApiHeaders } from '../utils/api.js';

const execFileAsync = promisify(execFile);
const SENSITIVE_KEY_PATTERN =
  /(token|secret|password|authorization|cookie|credential|apikey|api_key|private)/i;
const SENSITIVE_URL_KEY_PATTERN = /(webhook.*url|openclawGatewayUrl|url|destination)/i;

interface SnapshotOptions {
  apiBase: string;
  timeoutMs: number;
  format: 'json' | 'markdown';
  output?: string;
}

interface SnapshotDependencies {
  fetch: typeof fetch;
  env: NodeJS.ProcessEnv;
  now: () => Date;
  gitSha: () => Promise<string | null>;
  cliVersion: () => Promise<string>;
}

interface RequestResult<T> {
  ok: boolean;
  status: number;
  data: T | null;
  headers: Headers;
  error?: string;
}

interface HealthResponse {
  ok?: boolean;
  version?: string;
  uptimeMs?: number;
}

interface RepoResponse {
  name?: string;
  path?: string;
  defaultBranch?: string;
}

interface ManagedListResponse {
  id?: string;
  label?: string;
  isHidden?: boolean;
}

interface AgentResponse {
  type?: string;
  name?: string;
  command?: string;
  args?: string[];
  enabled?: boolean;
  provider?: string;
  model?: string;
}

interface AgentStatusResponse {
  status?: string;
  subAgentCount?: number;
  activeTask?: string;
  activeTaskTitle?: string;
  activeAgents?: Array<{
    agent?: string;
    status?: string;
    taskId?: string;
    taskTitle?: string;
    startedAt?: string;
  }>;
  lastUpdated?: string;
  error?: string;
}

interface RoutingResponse {
  enabled?: boolean;
  defaultAgent?: string;
  defaultModel?: string;
  fallbackOnFailure?: boolean;
  rules?: Array<{
    id?: string;
    name?: string;
    agent?: string;
    model?: string;
    fallback?: string;
    enabled?: boolean;
  }>;
}

interface FeatureSettingsResponse {
  notifications?: {
    enabled?: boolean;
    webhookUrl?: string;
    onTaskComplete?: boolean;
    onAgentFailure?: boolean;
    onReviewNeeded?: boolean;
  };
  hooks?: Record<string, unknown>;
  squadWebhook?: {
    enabled?: boolean;
    mode?: string;
    url?: string;
    openclawGatewayUrl?: string;
  };
}

interface PromptTemplateResponse {
  id?: string;
  name?: string;
  category?: string;
  version?: number;
}

interface TaskSummaryResponse {
  id?: string;
  status?: string;
  priority?: string;
  type?: string;
  project?: string;
  sprint?: string;
  agent?: string;
}

interface MaintenanceSummaryResponse {
  mode?: string;
  storageMode?: string;
  health?: Array<{ id?: string; state?: string; detail?: string }>;
  storage?: { totalBytes?: number; categories?: Array<{ id?: string; itemCount?: number }> };
  logs?: Array<{ id?: string; exists?: boolean; redacted?: boolean }>;
}

export interface RuntimeSnapshot {
  generatedAt: string;
  redacted: true;
  app: {
    cliVersion: string;
    serverVersion?: string;
    gitSha?: string;
    apiBase: string;
    apiReachable: boolean;
  };
  projects: {
    repos: Array<{ name: string; defaultBranch?: string; path: string }>;
    projects: Array<{ id: string; label: string; hidden: boolean }>;
    sprints: Array<{ id: string; label: string; hidden: boolean }>;
  };
  agents: {
    total: number;
    enabled: number;
    items: Array<{
      type: string;
      name?: string;
      provider?: string;
      model?: string;
      enabled: boolean;
      executable?: string;
    }>;
    status?: {
      state: string;
      subAgentCount: number;
      activeAgents: number;
      activeAgentsByStatus: Record<string, number>;
      activeTaskPresent: boolean;
      lastUpdated?: string;
      error?: string;
    };
  };
  routing: {
    enabled: boolean;
    defaultAgent?: string;
    defaultModel?: string;
    fallbackOnFailure: boolean;
    ruleCount: number;
    rules: Array<{
      id: string;
      name?: string;
      agent?: string;
      model?: string;
      fallback?: string;
      enabled: boolean;
    }>;
  };
  prompts: {
    count: number;
    templates: Array<{ id: string; name?: string; category?: string; version?: number }>;
  };
  tasks: {
    total: number;
    byStatus: Record<string, number>;
    byPriority: Record<string, number>;
    byType: Record<string, number>;
    duplicateIdentityConflicts: number;
  };
  notifications: {
    notificationsEnabled: boolean;
    notificationWebhookConfigured: boolean;
    squadWebhookEnabled: boolean;
    squadWebhookMode?: string;
    squadWebhookDestinationConfigured: boolean;
    lifecycleHooksEnabled: boolean;
    lifecycleHookActions: number;
  };
  health: {
    maintenanceAvailable: boolean;
    mode?: string;
    storageMode?: string;
    failingChecks: Array<{ id: string; state: string; detail?: string }>;
    warningChecks: Array<{ id: string; state: string; detail?: string }>;
    logs: Array<{ id: string; exists: boolean; redacted: boolean }>;
  };
  accessIssues: Array<{ section: string; status: number; error: string }>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function unwrapData<T>(body: unknown): T | null {
  if (isRecord(body) && body.success === true && 'data' in body) {
    return body.data as T;
  }
  return body as T;
}

function redactString(value: string, options: { redactUrls?: boolean } = {}): string {
  let redacted = value
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]')
    .replace(/\bsk-[A-Za-z0-9_-]{12,}/g, 'sk-[REDACTED]')
    .replace(/\bvk_[A-Za-z0-9_-]{12,}/g, 'vk_[REDACTED]')
    .replace(/\b[A-Fa-f0-9]{32,}\b/g, '[REDACTED_TOKEN]')
    .replace(/\/Users\/[^/\s]+\/[^\s)]+/g, '[redacted-local-path]')
    .replace(/[A-Z]:\\Users\\[^\\\s]+\\[^\s)]+/g, '[redacted-local-path]');

  if (options.redactUrls !== false) {
    redacted = redacted.replace(/https?:\/\/[^\s)]+/gi, (match) => redactUrl(match));
  }

  return redacted;
}

function redactUrl(value: string): string {
  try {
    const parsed = new URL(value);
    return `${parsed.protocol}//${parsed.host}/[redacted]`;
  } catch {
    return '[redacted-url]';
  }
}

function redactApiBase(value: string): string {
  const cleaned = redactString(value, { redactUrls: false });
  try {
    const parsed = new URL(cleaned);
    const hasPrivateParts = parsed.pathname !== '/' || parsed.search !== '' || parsed.hash !== '';
    return hasPrivateParts ? `${parsed.origin}/[redacted]` : parsed.origin;
  } catch {
    return cleaned;
  }
}

function redactValue(value: unknown, key = ''): unknown {
  if (typeof value === 'string') {
    if (key === 'apiBase') return redactApiBase(value);
    if (SENSITIVE_KEY_PATTERN.test(key)) return '[REDACTED]';
    if (SENSITIVE_URL_KEY_PATTERN.test(key) && key !== 'apiBase') return redactUrl(value);
    return redactString(value, { redactUrls: true });
  }
  if (Array.isArray(value)) return value.map((item) => redactValue(item));
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([entryKey, entryValue]) => [
        entryKey,
        redactValue(entryValue, entryKey),
      ])
    );
  }
  return value;
}

function executableName(command: string | undefined): string | undefined {
  return command?.trim().split(/\s+/)[0] || undefined;
}

function countBy<T>(items: T[], key: keyof T): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) {
    const raw = item[key];
    const value = typeof raw === 'string' && raw ? raw : 'unknown';
    counts[value] = (counts[value] ?? 0) + 1;
  }
  return counts;
}

function normalizeApiBase(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, '');
  try {
    return new URL(trimmed).origin;
  } catch {
    return trimmed;
  }
}

function activeLifecycleHookActions(settings: FeatureSettingsResponse | null): number {
  if (!settings?.hooks || settings.hooks.enabled !== true) return 0;
  return Object.entries(settings.hooks).filter(([key, value]) => {
    if (key === 'enabled' || !isRecord(value)) return false;
    return value.enabled === true && (value.webhook || value.notify);
  }).length;
}

async function defaultGitSha(): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', '--short', 'HEAD'], {
      timeout: 3000,
    });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

async function defaultCliVersion(): Promise<string> {
  try {
    const packageJson = JSON.parse(
      await readFile(new URL('../../package.json', import.meta.url), 'utf-8')
    ) as { version?: string };
    return packageJson.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

async function requestJson<T>(
  deps: SnapshotDependencies,
  options: SnapshotOptions,
  pathName: string
): Promise<RequestResult<T>> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs);

  try {
    const response = await deps.fetch(`${options.apiBase}${pathName}`, {
      headers: buildApiHeaders(undefined, deps.env.VK_API_KEY),
      signal: controller.signal,
    });
    const text = await response.text();
    const body = text ? JSON.parse(text) : null;
    const data = response.ok ? unwrapData<T>(body) : null;
    const error =
      !response.ok && isRecord(body)
        ? String(
            isRecord(body.error)
              ? (body.error.message ?? response.statusText)
              : (body.error ?? body.message ?? response.statusText)
          )
        : undefined;
    return { ok: response.ok, status: response.status, data, headers: response.headers, error };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      data: null,
      headers: new Headers(),
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timeout);
  }
}

function recordIssue(
  issues: RuntimeSnapshot['accessIssues'],
  section: string,
  response: RequestResult<unknown>
): void {
  if (response.ok) return;
  issues.push({
    section,
    status: response.status,
    error: redactString(response.error ?? 'request failed', { redactUrls: true }),
  });
}

export async function buildRuntimeSnapshot(
  input: Partial<SnapshotOptions> = {},
  depsInput: Partial<SnapshotDependencies> = {}
): Promise<RuntimeSnapshot> {
  const options: SnapshotOptions = {
    apiBase: normalizeApiBase(input.apiBase ?? API_BASE),
    timeoutMs: input.timeoutMs ?? 5000,
    format: input.format ?? 'json',
    output: input.output,
  };
  const deps: SnapshotDependencies = {
    fetch: depsInput.fetch ?? globalThis.fetch.bind(globalThis),
    env: depsInput.env ?? process.env,
    now: depsInput.now ?? (() => new Date()),
    gitSha: depsInput.gitSha ?? defaultGitSha,
    cliVersion: depsInput.cliVersion ?? defaultCliVersion,
  };
  const accessIssues: RuntimeSnapshot['accessIssues'] = [];

  const [
    cliVersion,
    gitSha,
    health,
    repos,
    projects,
    sprints,
    agents,
    agentStatus,
    routing,
    settings,
    prompts,
    tasks,
    maintenance,
  ] = await Promise.all([
    deps.cliVersion(),
    deps.gitSha(),
    requestJson<HealthResponse>(deps, options, '/api/health'),
    requestJson<RepoResponse[]>(deps, options, '/api/config/repos'),
    requestJson<ManagedListResponse[]>(deps, options, '/api/projects'),
    requestJson<ManagedListResponse[]>(deps, options, '/api/sprints'),
    requestJson<AgentResponse[]>(deps, options, '/api/config/agents'),
    requestJson<AgentStatusResponse>(deps, options, '/api/agent/status'),
    requestJson<RoutingResponse>(deps, options, '/api/agents/routing'),
    requestJson<FeatureSettingsResponse>(deps, options, '/api/settings/features'),
    requestJson<PromptTemplateResponse[]>(deps, options, '/api/prompt-registry'),
    requestJson<TaskSummaryResponse[]>(deps, options, '/api/tasks?view=summary'),
    requestJson<MaintenanceSummaryResponse>(deps, options, '/api/maintenance/summary'),
  ]);

  recordIssue(accessIssues, 'health', health);
  recordIssue(accessIssues, 'repos', repos);
  recordIssue(accessIssues, 'projects', projects);
  recordIssue(accessIssues, 'sprints', sprints);
  recordIssue(accessIssues, 'agents', agents);
  recordIssue(accessIssues, 'agent-status', agentStatus);
  recordIssue(accessIssues, 'routing', routing);
  recordIssue(accessIssues, 'settings', settings);
  recordIssue(accessIssues, 'prompts', prompts);
  recordIssue(accessIssues, 'tasks', tasks);
  recordIssue(accessIssues, 'maintenance', maintenance);

  const agentItems = (agents.data ?? []).map((agent) => ({
    type: agent.type ?? 'unknown',
    name: agent.name,
    provider: agent.provider,
    model: agent.model,
    enabled: Boolean(agent.enabled),
    executable: executableName(agent.command),
  }));
  const taskItems = tasks.data ?? [];
  const settingsData = settings.data;
  const maintenanceData = maintenance.data;
  const maintenanceHealth = maintenanceData?.health ?? [];
  const activeAgents = agentStatus.data?.activeAgents ?? [];
  const snapshot: RuntimeSnapshot = {
    generatedAt: deps.now().toISOString(),
    redacted: true,
    app: {
      cliVersion,
      ...(health.data?.version ? { serverVersion: health.data.version } : {}),
      ...(gitSha ? { gitSha } : {}),
      apiBase: options.apiBase,
      apiReachable: health.ok && (health.data?.ok ?? true),
    },
    projects: {
      repos: (repos.data ?? []).map((repo) => ({
        name: repo.name ?? 'unknown',
        defaultBranch: repo.defaultBranch,
        path: '[redacted path]',
      })),
      projects: (projects.data ?? []).map((project) => ({
        id: project.id ?? 'unknown',
        label: project.label ?? project.id ?? 'unknown',
        hidden: Boolean(project.isHidden),
      })),
      sprints: (sprints.data ?? []).map((sprint) => ({
        id: sprint.id ?? 'unknown',
        label: sprint.label ?? sprint.id ?? 'unknown',
        hidden: Boolean(sprint.isHidden),
      })),
    },
    agents: {
      total: agentItems.length,
      enabled: agentItems.filter((agent) => agent.enabled).length,
      items: agentItems,
      ...(agentStatus.data
        ? {
            status: {
              state: agentStatus.data.status ?? 'unknown',
              subAgentCount: agentStatus.data.subAgentCount ?? 0,
              activeAgents: activeAgents.length,
              activeAgentsByStatus: countBy(activeAgents, 'status'),
              activeTaskPresent: Boolean(agentStatus.data.activeTask),
              lastUpdated: agentStatus.data.lastUpdated,
              error: agentStatus.data.error,
            },
          }
        : {}),
    },
    routing: {
      enabled: Boolean(routing.data?.enabled),
      defaultAgent: routing.data?.defaultAgent,
      defaultModel: routing.data?.defaultModel,
      fallbackOnFailure: Boolean(routing.data?.fallbackOnFailure),
      ruleCount: routing.data?.rules?.length ?? 0,
      rules: (routing.data?.rules ?? []).map((rule) => ({
        id: rule.id ?? 'unknown',
        name: rule.name,
        agent: rule.agent,
        model: rule.model,
        fallback: rule.fallback,
        enabled: rule.enabled !== false,
      })),
    },
    prompts: {
      count: prompts.data?.length ?? 0,
      templates: (prompts.data ?? []).map((template) => ({
        id: template.id ?? 'unknown',
        name: template.name,
        category: template.category,
        version: template.version,
      })),
    },
    tasks: {
      total: taskItems.length,
      byStatus: countBy(taskItems, 'status'),
      byPriority: countBy(taskItems, 'priority'),
      byType: countBy(taskItems, 'type'),
      duplicateIdentityConflicts: Number(
        tasks.headers.get('x-veritas-task-identity-conflicts') ?? '0'
      ),
    },
    notifications: {
      notificationsEnabled: Boolean(settingsData?.notifications?.enabled),
      notificationWebhookConfigured: Boolean(settingsData?.notifications?.webhookUrl),
      squadWebhookEnabled: Boolean(settingsData?.squadWebhook?.enabled),
      squadWebhookMode: settingsData?.squadWebhook?.mode,
      squadWebhookDestinationConfigured: Boolean(
        settingsData?.squadWebhook?.url || settingsData?.squadWebhook?.openclawGatewayUrl
      ),
      lifecycleHooksEnabled: Boolean(settingsData?.hooks?.enabled),
      lifecycleHookActions: activeLifecycleHookActions(settingsData),
    },
    health: {
      maintenanceAvailable: maintenance.ok,
      mode: maintenanceData?.mode,
      storageMode: maintenanceData?.storageMode,
      failingChecks: maintenanceHealth
        .filter((item) => item.state === 'fail')
        .map((item) => ({
          id: item.id ?? 'unknown',
          state: item.state ?? 'unknown',
          detail: item.detail,
        })),
      warningChecks: maintenanceHealth
        .filter((item) => item.state === 'warn' || item.state === 'unknown')
        .map((item) => ({
          id: item.id ?? 'unknown',
          state: item.state ?? 'unknown',
          detail: item.detail,
        })),
      logs: (maintenanceData?.logs ?? []).map((log) => ({
        id: log.id ?? 'unknown',
        exists: Boolean(log.exists),
        redacted: log.redacted !== false,
      })),
    },
    accessIssues,
  };

  return redactValue(snapshot) as RuntimeSnapshot;
}

export function formatRuntimeSnapshotMarkdown(snapshot: RuntimeSnapshot): string {
  const lines = [
    '# Veritas Runtime Snapshot',
    '',
    `Generated: ${snapshot.generatedAt}`,
    `Redacted: ${snapshot.redacted ? 'yes' : 'no'}`,
    '',
    '## App',
    '',
    `- CLI version: ${snapshot.app.cliVersion}`,
    `- Server version: ${snapshot.app.serverVersion ?? 'unknown'}`,
    `- Git SHA: ${snapshot.app.gitSha ?? 'unknown'}`,
    `- API reachable: ${snapshot.app.apiReachable ? 'yes' : 'no'}`,
    '',
    '## Tasks',
    '',
    `- Total: ${snapshot.tasks.total}`,
    `- Duplicate identity conflicts: ${snapshot.tasks.duplicateIdentityConflicts}`,
    `- By status: ${JSON.stringify(snapshot.tasks.byStatus)}`,
    '',
    '## Agents',
    '',
    `- Total: ${snapshot.agents.total}`,
    `- Enabled: ${snapshot.agents.enabled}`,
    `- Global status: ${snapshot.agents.status?.state ?? 'unknown'}`,
    `- Active agents: ${snapshot.agents.status?.activeAgents ?? 0}`,
    `- Routing enabled: ${snapshot.routing.enabled ? 'yes' : 'no'}`,
    `- Routing rules: ${snapshot.routing.ruleCount}`,
    '',
    '## Prompts',
    '',
    `- Runtime templates: ${snapshot.prompts.count}`,
    '',
    '## Notifications',
    '',
    `- Notifications enabled: ${snapshot.notifications.notificationsEnabled ? 'yes' : 'no'}`,
    `- Notification webhook configured: ${
      snapshot.notifications.notificationWebhookConfigured ? 'yes' : 'no'
    }`,
    `- Squad webhook enabled: ${snapshot.notifications.squadWebhookEnabled ? 'yes' : 'no'}`,
    `- Lifecycle hook actions: ${snapshot.notifications.lifecycleHookActions}`,
    '',
    '## Health',
    '',
    `- Maintenance summary available: ${snapshot.health.maintenanceAvailable ? 'yes' : 'no'}`,
    `- Failing checks: ${snapshot.health.failingChecks.length}`,
    `- Warning checks: ${snapshot.health.warningChecks.length}`,
    '',
  ];

  if (snapshot.accessIssues.length > 0) {
    lines.push('## Access Issues', '');
    for (const issue of snapshot.accessIssues) {
      lines.push(`- ${issue.section}: ${issue.status} ${issue.error}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

function parseFormat(value: string): SnapshotOptions['format'] {
  if (value === 'json' || value === 'markdown') return value;
  throw new Error('Snapshot format must be json or markdown');
}

export function registerSnapshotCommand(program: Command): void {
  program
    .command('snapshot')
    .description('Export a redacted runtime support snapshot')
    .option('--format <format>', 'Output format: json or markdown', 'json')
    .option('--output <path>', 'Write snapshot to a file instead of stdout')
    .option('--api <url>', 'API base URL', API_BASE)
    .option('--timeout <ms>', 'Per-request timeout in milliseconds', '5000')
    .action(async (options) => {
      const timeoutMs = Number(options.timeout);
      const format = parseFormat(options.format);
      const snapshot = await buildRuntimeSnapshot({
        apiBase: options.api,
        timeoutMs: Number.isFinite(timeoutMs) ? timeoutMs : 5000,
        format,
        output: options.output,
      });
      const rendered =
        format === 'markdown'
          ? formatRuntimeSnapshotMarkdown(snapshot)
          : `${JSON.stringify(snapshot, null, 2)}\n`;

      if (options.output) {
        const outputPath = path.resolve(options.output);
        await writeFile(outputPath, rendered, 'utf-8');
        console.log(chalk.green(`Snapshot written to ${path.basename(outputPath)}`));
      } else {
        process.stdout.write(rendered);
      }
    });
}
