/**
 * Abstract base class for integration providers.
 *
 * All providers (Todoist, Jira, etc.) extend this class to implement
 * connect/disconnect, push/pull tasks, and webhook handling.
 */
import type {
  IntegrationConfig,
  IntegrationSecrets,
  ExternalTask,
  SyncResult,
  OAuthResult,
  ProviderInfo,
} from './types.js';

export abstract class IntegrationProvider {
  /** Provider metadata for UI display. */
  abstract readonly info: ProviderInfo;

  /**
   * Connect to the external service.
   * For OAuth2 providers, this exchanges the auth code for tokens.
   */
  abstract connect(params: Record<string, string>): Promise<OAuthResult>;

  /**
   * Disconnect from the external service.
   * Revokes tokens if the provider supports it.
   */
  abstract disconnect(secrets: IntegrationSecrets): Promise<void>;

  /**
   * Pull tasks from the external service.
   */
  abstract pullTasks(
    secrets: IntegrationSecrets,
    config: IntegrationConfig
  ): Promise<ExternalTask[]>;

  /**
   * Push a task to the external service.
   * Returns the external ID of the created/updated task.
   */
  abstract pushTask(
    secrets: IntegrationSecrets,
    config: IntegrationConfig,
    task: { title: string; description: string; priority: string; dueDate?: string }
  ): Promise<string>;

  /**
   * Check connection by pulling tasks and reporting counts.
   * Does not perform a full bidirectional sync.
   */
  abstract checkConnection(
    secrets: IntegrationSecrets,
    config: IntegrationConfig
  ): Promise<SyncResult>;

  /**
   * Handle an incoming webhook from the external service.
   * Returns the affected external task IDs.
   */
  abstract handleWebhook(
    payload: unknown,
    headers: Record<string, string | string[] | undefined>
  ): Promise<string[]>;
}
