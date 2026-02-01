/**
 * Todoist integration provider.
 *
 * Implements OAuth2 authentication and task sync via Todoist REST API v2.
 * @see https://developer.todoist.com/rest/v2
 */
import { z } from 'zod';
import { IntegrationProvider } from './base.js';
import type {
  IntegrationConfig,
  IntegrationSecrets,
  ExternalTask,
  SyncResult,
  OAuthResult,
  ProviderInfo,
  VeritasPriority,
} from './types.js';
import { createLogger } from '../lib/logger.js';

const log = createLogger('integration:todoist');

const TODOIST_API_BASE = 'https://api.todoist.com/rest/v2';
const TODOIST_AUTH_URL = 'https://todoist.com/oauth/authorize';
const TODOIST_TOKEN_URL = 'https://todoist.com/oauth/access_token';

/** Todoist priority (1=normal, 4=urgent) → Veritas priority. */
function todoistPriorityToVeritas(p: number): VeritasPriority {
  if (p >= 4) return 'high';
  if (p >= 3) return 'medium';
  return 'low';
}

/** Veritas priority → Todoist priority (1–4). */
function veritasPriorityToTodoist(p: string): number {
  switch (p) {
    case 'high':
      return 4;
    case 'medium':
      return 3;
    default:
      return 1;
  }
}

interface TodoistTask {
  id: string;
  content: string;
  description: string;
  is_completed: boolean;
  priority: number;
  due?: { date: string };
}

export class TodoistProvider extends IntegrationProvider {
  readonly info: ProviderInfo = {
    id: 'todoist',
    name: 'Todoist',
    description: 'Sync tasks with Todoist projects',
    icon: 'todoist',
    authType: 'oauth2',
    oauthUrl: TODOIST_AUTH_URL,
  };

  async connect(params: Record<string, string>): Promise<OAuthResult> {
    const { code } = params;
    if (!code) {
      throw new Error('Missing required OAuth parameter: code');
    }

    const clientId = process.env.TODOIST_CLIENT_ID;
    const clientSecret = process.env.TODOIST_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      throw new Error(
        'TODOIST_CLIENT_ID and TODOIST_CLIENT_SECRET must be set in server environment'
      );
    }

    const response = await fetch(TODOIST_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      log.error({ status: response.status, body: text }, 'Todoist OAuth token exchange failed');
      throw new Error(`Todoist OAuth failed: ${response.status}`);
    }

    const data = (await response.json()) as { access_token: string; token_type: string };
    return { accessToken: data.access_token };
  }

  async disconnect(_secrets: IntegrationSecrets): Promise<void> {
    // Todoist OAuth tokens don't support revocation via API.
    // The user can revoke via Todoist settings.
    log.info('Todoist disconnected (token cleared locally)');
  }

  async pullTasks(secrets: IntegrationSecrets, config: IntegrationConfig): Promise<ExternalTask[]> {
    if (!secrets.accessToken) {
      throw new Error('Not connected to Todoist');
    }

    const projectId = config.providerConfig.projectId as string | undefined;
    let url = `${TODOIST_API_BASE}/tasks`;
    if (projectId) {
      url += `?project_id=${encodeURIComponent(projectId)}`;
    }

    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${secrets.accessToken}` },
    });

    if (!response.ok) {
      throw new Error(`Todoist API error: ${response.status}`);
    }

    const tasks = (await response.json()) as TodoistTask[];
    return tasks.map((t) => ({
      externalId: t.id,
      title: t.content,
      description: t.description || '',
      status: t.is_completed ? 'completed' : 'open',
      priority: todoistPriorityToVeritas(t.priority),
      dueDate: t.due?.date,
      raw: t,
    }));
  }

  async pushTask(
    secrets: IntegrationSecrets,
    config: IntegrationConfig,
    task: { title: string; description: string; priority: string; dueDate?: string }
  ): Promise<string> {
    if (!secrets.accessToken) {
      throw new Error('Not connected to Todoist');
    }

    const body: Record<string, unknown> = {
      content: task.title,
      description: task.description,
      priority: veritasPriorityToTodoist(task.priority),
    };

    const projectId = config.providerConfig.projectId as string | undefined;
    if (projectId) {
      body.project_id = projectId;
    }

    if (task.dueDate) {
      body.due_date = task.dueDate;
    }

    const response = await fetch(`${TODOIST_API_BASE}/tasks`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secrets.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`Todoist API error: ${response.status}`);
    }

    const created = (await response.json()) as { id: string };
    return created.id;
  }

  async checkConnection(
    secrets: IntegrationSecrets,
    config: IntegrationConfig
  ): Promise<SyncResult> {
    const tasks = await this.pullTasks(secrets, config);
    return {
      pulled: tasks.length,
      pushed: 0,
      errors: [],
    };
  }

  private static readonly webhookSchema = z.object({
    event_name: z.string().optional(),
    event_data: z
      .object({
        id: z.string(),
      })
      .optional(),
  });

  async handleWebhook(
    payload: unknown,
    _headers: Record<string, string | string[] | undefined>
  ): Promise<string[]> {
    const parsed = TodoistProvider.webhookSchema.safeParse(payload);
    if (!parsed.success) {
      log.warn({ errors: parsed.error.issues }, 'Invalid Todoist webhook payload');
      return [];
    }

    if (parsed.data.event_data?.id) {
      return [parsed.data.event_data.id];
    }
    return [];
  }
}
