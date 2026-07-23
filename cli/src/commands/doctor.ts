import { Command } from 'commander';
import chalk from 'chalk';
import { execFile } from 'node:child_process';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { API_BASE, buildApiHeaders } from '../utils/api.js';
import type { HarnessSupportStatus } from '@veritas-kanban/shared';

const execFileAsync = promisify(execFile);
const CRITICAL_STATUSES = new Set<DoctorCheck['id']>([
  'node',
  'api-health',
  'api-auth',
  'tasks',
  'agents',
  'harness-support',
  'routing',
]);

export type DoctorStatus = 'pass' | 'warn' | 'fail' | 'skip';

export interface DoctorCheck {
  id: string;
  label: string;
  status: DoctorStatus;
  message: string;
  details?: Record<string, unknown>;
  remediation?: string;
}

export interface DoctorReport {
  ok: boolean;
  generatedAt: string;
  apiBase: string;
  projectRoot?: string;
  summary: Record<DoctorStatus, number>;
  checks: DoctorCheck[];
}

interface DoctorOptions {
  apiBase: string;
  cwd: string;
  json: boolean;
  showPaths: boolean;
  timeoutMs: number;
}

interface DoctorDependencies {
  fetch: typeof fetch;
  env: NodeJS.ProcessEnv;
  resolveCommand: (command: string) => Promise<string | null>;
  findProjectRoot: (cwd: string) => Promise<string | null>;
  countPromptTemplateFiles: (root: string | null) => Promise<number | null>;
  now: () => Date;
}

interface HealthResponse {
  ok?: boolean;
  version?: string;
  uptimeMs?: number;
}

interface AuthContextResponse {
  role?: string;
  authMethod?: string;
  isLocalhost?: boolean;
  permissions?: string[];
}

interface AgentConfigResponse {
  type: string;
  name?: string;
  command?: string;
  enabled?: boolean;
  provider?: string;
}

interface RoutingConfigResponse {
  enabled?: boolean;
  defaultAgent?: string;
  fallbackOnFailure?: boolean;
  rules?: Array<{
    id?: string;
    agent?: string;
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
  hooks?: {
    enabled?: boolean;
    onCreated?: { enabled?: boolean; webhook?: string; notify?: boolean };
    onStarted?: { enabled?: boolean; webhook?: string; notify?: boolean };
    onBlocked?: { enabled?: boolean; webhook?: string; notify?: boolean };
    onCompleted?: { enabled?: boolean; webhook?: string; notify?: boolean };
    onArchived?: { enabled?: boolean; webhook?: string; notify?: boolean };
  };
  squadWebhook?: {
    enabled?: boolean;
    mode?: 'webhook' | 'openclaw';
    url?: string;
    openclawGatewayUrl?: string;
  };
}

interface CodexHealthResponse {
  ready?: {
    overall?: boolean;
    cli?: boolean;
    sdk?: boolean;
    cloud?: boolean;
  };
  cli?: {
    installed?: boolean;
    authenticated?: boolean;
  };
  recommendations?: string[];
}

interface RequestResult<T> {
  ok: boolean;
  status: number;
  data: T | null;
  headers: Headers;
  error?: string;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

async function defaultResolveCommand(command: string): Promise<string | null> {
  const executable = command.trim().split(/\s+/)[0];
  if (!executable) return null;

  try {
    const { stdout } = await execFileAsync('sh', ['-c', `command -v ${shellQuote(executable)}`], {
      timeout: 3000,
    });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

async function defaultFindProjectRoot(cwd: string): Promise<string | null> {
  let current = path.resolve(cwd);

  while (true) {
    const packageJsonPath = path.join(current, 'package.json');
    try {
      const raw = await readFile(packageJsonPath, 'utf-8');
      const parsed = JSON.parse(raw) as { name?: string; private?: boolean };
      if (parsed.name === 'veritas-kanban' || parsed.private === true) {
        return current;
      }
    } catch {
      // Keep walking up.
    }

    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

async function defaultCountPromptTemplateFiles(root: string | null): Promise<number | null> {
  if (!root) return null;

  const candidates = [
    path.join(root, '.veritas-kanban', 'prompt-templates'),
    path.join(root, 'server', '.veritas-kanban', 'prompt-templates'),
  ];

  for (const candidate of candidates) {
    try {
      const info = await stat(candidate);
      if (!info.isDirectory()) continue;
      const entries = await readdir(candidate);
      return entries.filter((entry) => entry.endsWith('.md')).length;
    } catch {
      // Try the next candidate.
    }
  }

  return null;
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

function countSummary(checks: DoctorCheck[]): Record<DoctorStatus, number> {
  return {
    pass: checks.filter((check) => check.status === 'pass').length,
    warn: checks.filter((check) => check.status === 'warn').length,
    fail: checks.filter((check) => check.status === 'fail').length,
    skip: checks.filter((check) => check.status === 'skip').length,
  };
}

function check(
  id: string,
  label: string,
  status: DoctorStatus,
  message: string,
  details?: Record<string, unknown>,
  remediation?: string
): DoctorCheck {
  return {
    id,
    label,
    status,
    message,
    ...(details ? { details } : {}),
    ...(remediation ? { remediation } : {}),
  };
}

function firstCommandToken(command: string | undefined): string {
  return command?.trim().split(/\s+/)[0] ?? '';
}

function redactPathForOutput(
  value: string | null | undefined,
  options: DoctorOptions
): string | undefined {
  if (!value) return undefined;
  if (!options.showPaths) return '[redacted path]';
  const home = options.cwd.startsWith('/') ? process.env.HOME : undefined;
  return home && value.startsWith(home) ? value.replace(home, '~') : value;
}

function redactUrlForMessage(value: string | undefined): string {
  if (!value) return 'not configured';
  try {
    const parsed = new URL(value);
    return `${parsed.protocol}//${parsed.host}/[redacted]`;
  } catch {
    return '[redacted url]';
  }
}

async function requestJson<T>(
  deps: DoctorDependencies,
  options: DoctorOptions,
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

    return {
      ok: response.ok,
      status: response.status,
      data,
      headers: response.headers,
      error,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      status: 0,
      data: null,
      headers: new Headers(),
      error: message,
    };
  } finally {
    clearTimeout(timeout);
  }
}

function activeHookCount(settings: FeatureSettingsResponse): number {
  const hooks = settings.hooks;
  if (!hooks?.enabled) return 0;
  return [
    hooks.onCreated,
    hooks.onStarted,
    hooks.onBlocked,
    hooks.onCompleted,
    hooks.onArchived,
  ].filter((hook) => hook?.enabled && (hook.webhook || hook.notify)).length;
}

async function buildAgentCheck(
  deps: DoctorDependencies,
  agents: AgentConfigResponse[] | null
): Promise<{ check: DoctorCheck; availableAgents: Set<string>; configuredAgents: Set<string> }> {
  const availableAgents = new Set<string>();
  const configuredAgents = new Set<string>();

  if (!agents) {
    return {
      check: check(
        'agents',
        'Agent executables',
        'skip',
        'Skipped because agent config was unavailable'
      ),
      availableAgents,
      configuredAgents,
    };
  }

  if (agents.length === 0) {
    return {
      check: check(
        'agents',
        'Agent executables',
        'fail',
        'No agents are configured',
        undefined,
        'Configure at least one enabled agent before running real tasks.'
      ),
      availableAgents,
      configuredAgents,
    };
  }

  const enabledAgents = agents.filter((agent) => agent.enabled);
  const missing: string[] = [];
  const disabled = agents.length - enabledAgents.length;

  for (const agent of agents) {
    configuredAgents.add(agent.type);
  }

  for (const agent of enabledAgents) {
    const executable = firstCommandToken(agent.command);
    const resolved = executable ? await deps.resolveCommand(executable) : null;
    if (resolved) {
      availableAgents.add(agent.type);
    } else {
      missing.push(`${agent.type}${executable ? ` (${executable})` : ''}`);
    }
  }

  if (missing.length > 0) {
    return {
      check: check(
        'agents',
        'Agent executables',
        'fail',
        `${missing.length} enabled agent executable(s) were not found`,
        { enabled: enabledAgents.length, disabled, missing },
        'Install missing agent CLIs or disable those agents in settings.'
      ),
      availableAgents,
      configuredAgents,
    };
  }

  return {
    check: check(
      'agents',
      'Agent executables',
      'pass',
      `${enabledAgents.length} enabled agent(s) available`,
      {
        enabled: enabledAgents.length,
        disabled,
      }
    ),
    availableAgents,
    configuredAgents,
  };
}

function buildRoutingCheck(
  routing: RoutingConfigResponse | null,
  availableAgents: Set<string>,
  configuredAgents: Set<string>
): DoctorCheck {
  if (!routing) {
    return check(
      'routing',
      'Agent routing',
      'skip',
      'Skipped because routing config was unavailable'
    );
  }

  if (!routing.enabled) {
    return check('routing', 'Agent routing', 'warn', 'Agent routing is disabled');
  }

  const missing: string[] = [];
  const unavailable: string[] = [];
  const rules = routing.rules ?? [];

  const requireAgent = (agent: string | undefined, source: string) => {
    if (!agent) return;
    if (!configuredAgents.has(agent)) missing.push(`${source}: ${agent}`);
    else if (!availableAgents.has(agent)) unavailable.push(`${source}: ${agent}`);
  };

  requireAgent(routing.defaultAgent, 'default');
  for (const rule of rules.filter((item) => item.enabled !== false)) {
    requireAgent(rule.agent, `rule ${rule.id ?? 'unnamed'}`);
    if (routing.fallbackOnFailure || rule.fallback) {
      requireAgent(rule.fallback, `fallback ${rule.id ?? 'unnamed'}`);
    }
  }

  if (missing.length > 0 || unavailable.length > 0) {
    return check(
      'routing',
      'Agent routing',
      'fail',
      'Routing points to missing or unavailable agents',
      { missing, unavailable },
      'Update routing rules or make the referenced agents available.'
    );
  }

  return check('routing', 'Agent routing', 'pass', `${rules.length} routing rule(s) checked`, {
    defaultAgent: routing.defaultAgent,
    fallbackOnFailure: Boolean(routing.fallbackOnFailure),
  });
}

function buildNotificationsCheck(settings: FeatureSettingsResponse | null): DoctorCheck {
  if (!settings) {
    return check(
      'notifications',
      'Notifications and webhooks',
      'skip',
      'Skipped because feature settings were unavailable'
    );
  }

  const notificationEnabled = Boolean(settings.notifications?.enabled);
  const notificationWebhook = Boolean(settings.notifications?.webhookUrl);
  const squadWebhookEnabled = Boolean(settings.squadWebhook?.enabled);
  const hookCount = activeHookCount(settings);
  const configured = [
    notificationEnabled ? 'notifications' : null,
    notificationWebhook ? 'notification webhook' : null,
    squadWebhookEnabled ? `squad ${settings.squadWebhook?.mode ?? 'webhook'}` : null,
    hookCount > 0 ? `${hookCount} lifecycle hook(s)` : null,
  ].filter(Boolean);

  if (configured.length === 0) {
    return check(
      'notifications',
      'Notifications and webhooks',
      'pass',
      'No outbound notification or webhook paths are enabled'
    );
  }

  return check(
    'notifications',
    'Notifications and webhooks',
    'warn',
    `${configured.join(', ')} configured; delivery is not smoke-verified by doctor`,
    {
      notificationWebhook: notificationWebhook
        ? redactUrlForMessage(settings.notifications?.webhookUrl)
        : 'not configured',
      squadWebhook: squadWebhookEnabled
        ? redactUrlForMessage(
            settings.squadWebhook?.url || settings.squadWebhook?.openclawGatewayUrl
          )
        : 'not configured',
      lifecycleHooks: hookCount,
    },
    'Run a manual smoke event to verify configured delivery paths.'
  );
}

function buildCodexCheck(health: CodexHealthResponse | null): DoctorCheck {
  if (!health) {
    return check(
      'codex-health',
      'Codex health',
      'skip',
      'Skipped because Codex health was unavailable'
    );
  }

  if (health.ready?.overall) {
    return check(
      'codex-health',
      'Codex health',
      'pass',
      'At least one Codex provider path is ready',
      {
        cli: Boolean(health.ready.cli),
        sdk: Boolean(health.ready.sdk),
        cloud: Boolean(health.ready.cloud),
      }
    );
  }

  return check(
    'codex-health',
    'Codex health',
    'warn',
    'Codex provider paths are configured but not fully verified',
    {
      cliInstalled: Boolean(health.cli?.installed),
      cliAuthenticated: Boolean(health.cli?.authenticated),
      recommendations: health.recommendations?.slice(0, 3) ?? [],
    },
    'Run `codex login` or update Codex agent settings if Codex agents are expected.'
  );
}

function buildHarnessSupportCheck(statuses: HarnessSupportStatus[] | null): DoctorCheck {
  if (!statuses) {
    return check(
      'harness-support',
      'Harness support',
      'skip',
      'Skipped because harness support evidence was unavailable'
    );
  }

  const counts = Object.fromEntries(
    ['detected', 'configured', 'certified', 'degraded', 'unsupported'].map((tier) => [
      tier,
      statuses.filter((status) => status.supportTier === tier).length,
    ])
  ) as Record<HarnessSupportStatus['supportTier'], number>;
  const enabled = statuses.filter((status) => status.enabled);
  const blocking = enabled.filter(
    (status) => status.supportTier === 'degraded' || status.supportTier === 'unsupported'
  );

  if (blocking.length > 0) {
    return check(
      'harness-support',
      'Harness support',
      'fail',
      `${blocking.length} enabled harness profile(s) cannot dispatch safely`,
      {
        ...counts,
        blocking: blocking.map((status) => ({
          profileId: status.profileId,
          adapterId: status.adapterId,
          tier: status.supportTier,
          failureClass: status.failureClass,
          reason: status.reason,
          diagnosticCommands: status.diagnosticCommands,
          remediation: status.remediation,
        })),
      },
      'Disable unsupported profiles or follow the profile remediation before dispatch.'
    );
  }

  const uncertified = enabled.filter((status) => status.supportTier !== 'certified');
  if (uncertified.length > 0) {
    return check(
      'harness-support',
      'Harness support',
      'warn',
      `${uncertified.length} enabled harness profile(s) are configured but not certified`,
      counts,
      'Run the pinned harness conformance fixtures before treating these runtimes as certified.'
    );
  }

  return check(
    'harness-support',
    'Harness support',
    'pass',
    `${enabled.length} enabled harness profile(s) have current certification evidence`,
    counts
  );
}

export async function runDoctorChecks(
  input: Partial<DoctorOptions> = {},
  depsInput: Partial<DoctorDependencies> = {}
): Promise<DoctorReport> {
  const options: DoctorOptions = {
    apiBase: input.apiBase ?? API_BASE,
    cwd: input.cwd ?? process.cwd(),
    json: input.json ?? false,
    showPaths: input.showPaths ?? false,
    timeoutMs: input.timeoutMs ?? 5000,
  };
  const deps: DoctorDependencies = {
    fetch: depsInput.fetch ?? globalThis.fetch.bind(globalThis),
    env: depsInput.env ?? process.env,
    resolveCommand: depsInput.resolveCommand ?? defaultResolveCommand,
    findProjectRoot: depsInput.findProjectRoot ?? defaultFindProjectRoot,
    countPromptTemplateFiles: depsInput.countPromptTemplateFiles ?? defaultCountPromptTemplateFiles,
    now: depsInput.now ?? (() => new Date()),
  };

  const checks: DoctorCheck[] = [];

  const nodeMajor = Number(process.version.slice(1).split('.')[0]);
  checks.push(
    nodeMajor >= 22
      ? check('node', 'Node.js runtime', 'pass', `Node.js ${process.version}`)
      : check(
          'node',
          'Node.js runtime',
          'fail',
          `Node.js ${process.version} is below the required major version`,
          undefined,
          'Install Node.js 22 or newer.'
        )
  );

  const projectRoot = await deps.findProjectRoot(options.cwd);
  checks.push(
    projectRoot
      ? check('project-root', 'Project root', 'pass', 'Detected Veritas Kanban checkout', {
          path: redactPathForOutput(projectRoot, options),
        })
      : check(
          'project-root',
          'Project root',
          'warn',
          'Could not detect a Veritas Kanban checkout from the current directory'
        )
  );

  const linkedVk = await deps.resolveCommand('vk');
  const linkedPath = redactPathForOutput(linkedVk, options);
  const linkedToCurrentCheckout = Boolean(projectRoot && linkedVk?.startsWith(projectRoot));
  checks.push(
    linkedVk
      ? check(
          'cli-link',
          'CLI link',
          linkedToCurrentCheckout ? 'pass' : 'warn',
          linkedToCurrentCheckout
            ? '`vk` is linked to this checkout'
            : '`vk` is on PATH but may not point at this checkout',
          { path: linkedPath }
        )
      : check(
          'cli-link',
          'CLI link',
          'warn',
          '`vk` was not found on PATH',
          undefined,
          'Run the repo build/link workflow if a global `vk` command is expected.'
        )
  );

  const health = await requestJson<HealthResponse>(deps, options, '/api/health');
  const apiReachable = health.ok && (health.data?.ok ?? true);
  checks.push(
    apiReachable
      ? check('api-health', 'API reachability', 'pass', `API reachable at ${options.apiBase}`, {
          version: health.data?.version ?? 'unknown',
        })
      : check(
          'api-health',
          'API reachability',
          'fail',
          `API is not reachable at ${options.apiBase}`,
          { status: health.status, error: health.error ?? 'request failed' },
          'Start the server or set VK_API_URL to the active API origin.'
        )
  );

  let agents: AgentConfigResponse[] | null = null;
  let harnessSupport: HarnessSupportStatus[] | null = null;
  let routing: RoutingConfigResponse | null = null;
  let settings: FeatureSettingsResponse | null = null;

  if (apiReachable) {
    const auth = await requestJson<AuthContextResponse>(deps, options, '/api/auth/context');
    checks.push(
      auth.ok
        ? check(
            'api-auth',
            'API authentication',
            'pass',
            `Authenticated as ${auth.data?.role ?? 'unknown'}`,
            {
              method: auth.data?.authMethod ?? 'unknown',
              localhost: Boolean(auth.data?.isLocalhost),
              permissions: auth.data?.permissions?.length ?? 0,
            }
          )
        : check(
            'api-auth',
            'API authentication',
            'fail',
            'API authentication context is unavailable',
            { status: auth.status, error: auth.error ?? 'request failed' },
            'Set VK_API_KEY, enable localhost bypass for local setup, or log in through the app.'
          )
    );

    const tasks = await requestJson<unknown>(deps, options, '/api/tasks?view=summary&limit=1');
    const conflictCount = Number(tasks.headers.get('x-veritas-task-identity-conflicts') ?? '0');
    checks.push(
      tasks.ok && conflictCount === 0
        ? check(
            'tasks',
            'Task API and identity',
            'pass',
            'Task list is reachable and no duplicate IDs were reported'
          )
        : check(
            'tasks',
            'Task API and identity',
            'fail',
            conflictCount > 0
              ? `${conflictCount} duplicate task/card ID conflict(s) reported`
              : 'Task list is not reachable',
            { status: tasks.status, conflicts: conflictCount, error: tasks.error },
            conflictCount > 0
              ? 'Resolve duplicate task IDs across active, backlog, and archive files.'
              : 'Fix API permissions or task storage before running setup-sensitive commands.'
          )
    );

    const agentsResponse = await requestJson<AgentConfigResponse[]>(
      deps,
      options,
      '/api/config/agents'
    );
    agents = agentsResponse.ok ? agentsResponse.data : null;

    const harnessSupportResponse = await requestJson<HarnessSupportStatus[]>(
      deps,
      options,
      '/api/config/agent-support'
    );
    harnessSupport = harnessSupportResponse.ok ? harnessSupportResponse.data : null;

    const routingResponse = await requestJson<RoutingConfigResponse>(
      deps,
      options,
      '/api/agents/routing'
    );
    routing = routingResponse.ok ? routingResponse.data : null;

    const settingsResponse = await requestJson<FeatureSettingsResponse>(
      deps,
      options,
      '/api/settings/features'
    );
    settings = settingsResponse.ok ? settingsResponse.data : null;

    const promptResponse = await requestJson<unknown[]>(deps, options, '/api/prompt-registry');
    const runtimeTemplates = Array.isArray(promptResponse.data) ? promptResponse.data.length : null;
    const fileTemplates = await deps.countPromptTemplateFiles(projectRoot);
    checks.push(
      promptResponse.ok
        ? check(
            'prompt-registry',
            'Prompt registry',
            fileTemplates !== null && runtimeTemplates !== null && fileTemplates > runtimeTemplates
              ? 'warn'
              : 'pass',
            `Runtime registry has ${runtimeTemplates ?? 0} template(s)`,
            {
              runtimeTemplates: runtimeTemplates ?? 0,
              fileTemplates: fileTemplates ?? 'not checked',
            },
            fileTemplates !== null && runtimeTemplates !== null && fileTemplates > runtimeTemplates
              ? 'Run the prompt import/sync flow before relying on file-based templates.'
              : undefined
          )
        : check('prompt-registry', 'Prompt registry', 'warn', 'Prompt registry could not be read', {
            status: promptResponse.status,
            error: promptResponse.error,
          })
    );

    const codexHealth = await requestJson<CodexHealthResponse>(
      deps,
      options,
      '/api/settings/codex/health'
    );
    checks.push(buildCodexCheck(codexHealth.ok ? codexHealth.data : null));
  } else {
    checks.push(
      check('api-auth', 'API authentication', 'skip', 'Skipped because API is unreachable')
    );
    checks.push(
      check('tasks', 'Task API and identity', 'skip', 'Skipped because API is unreachable')
    );
    checks.push(
      check('prompt-registry', 'Prompt registry', 'skip', 'Skipped because API is unreachable')
    );
    checks.push(
      check('codex-health', 'Codex health', 'skip', 'Skipped because API is unreachable')
    );
    checks.push(
      check('harness-support', 'Harness support', 'skip', 'Skipped because API is unreachable')
    );
  }

  const agentResult = await buildAgentCheck(deps, agents);
  checks.push(agentResult.check);
  if (apiReachable) checks.push(buildHarnessSupportCheck(harnessSupport));
  checks.push(
    buildRoutingCheck(routing, agentResult.availableAgents, agentResult.configuredAgents)
  );
  checks.push(buildNotificationsCheck(settings));

  const hasCriticalFailure = checks.some(
    (item) => item.status === 'fail' && CRITICAL_STATUSES.has(item.id)
  );
  return {
    ok: !hasCriticalFailure,
    generatedAt: deps.now().toISOString(),
    apiBase: options.apiBase,
    ...(projectRoot ? { projectRoot: redactPathForOutput(projectRoot, options) } : {}),
    summary: countSummary(checks),
    checks,
  };
}

function statusColor(status: DoctorStatus): (value: string) => string {
  switch (status) {
    case 'pass':
      return chalk.green;
    case 'warn':
      return chalk.yellow;
    case 'fail':
      return chalk.red;
    case 'skip':
      return chalk.dim;
  }
}

export function formatDoctorReport(report: DoctorReport): string {
  const lines = [chalk.bold('Veritas Kanban Doctor'), chalk.dim(`API: ${report.apiBase}`), ''];

  for (const item of report.checks) {
    const color = statusColor(item.status);
    lines.push(
      `${color(`[${item.status.toUpperCase()}]`)} ${chalk.bold(item.label)} - ${item.message}`
    );
    if (item.remediation) {
      lines.push(chalk.dim(`  ${item.remediation}`));
    }
  }

  lines.push('');
  lines.push(
    `Summary: ${report.summary.pass} pass, ${report.summary.warn} warn, ${report.summary.fail} fail, ${report.summary.skip} skip`
  );
  lines.push(
    report.ok ? chalk.green('Doctor result: clean') : chalk.red('Doctor result: blockers found')
  );
  return lines.join('\n');
}

export function registerDoctorCommand(program: Command): void {
  program
    .command('doctor')
    .description('Run setup health checks for the local Veritas Kanban instance')
    .option('--json', 'Output copy/paste-safe JSON')
    .option('--api <url>', 'API base URL', API_BASE)
    .option('--show-paths', 'Include local paths in output')
    .option('--timeout <ms>', 'Per-request timeout in milliseconds', '5000')
    .action(async (options) => {
      const timeoutMs = Number(options.timeout);
      const report = await runDoctorChecks({
        apiBase: options.api,
        cwd: process.cwd(),
        json: Boolean(options.json),
        showPaths: Boolean(options.showPaths),
        timeoutMs: Number.isFinite(timeoutMs) ? timeoutMs : 5000,
      });

      if (options.json) {
        console.log(JSON.stringify(report, null, 2));
      } else {
        console.log(formatDoctorReport(report));
      }

      process.exit(report.ok ? 0 : 1);
    });
}
