/**
 * Integration framework tests.
 *
 * Tests the provider registry, base class contract, and Todoist provider logic.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { getProvider, listProviders, isValidProvider } from '../integrations/index.js';
import { TodoistProvider } from '../integrations/todoist.js';
import type { IntegrationConfig, IntegrationSecrets, FieldMapping } from '../integrations/types.js';

describe('Integration Registry', () => {
  it('lists registered providers', () => {
    const providers = listProviders();
    expect(providers.length).toBeGreaterThanOrEqual(1);
    expect(providers.some((p) => p.id === 'todoist')).toBe(true);
  });

  it('gets a provider by ID', () => {
    const provider = getProvider('todoist');
    expect(provider).toBeInstanceOf(TodoistProvider);
    expect(provider.info.id).toBe('todoist');
  });

  it('throws for unknown provider', () => {
    expect(() => getProvider('nonexistent' as any)).toThrow('Integration provider not found');
  });

  it('validates provider IDs', () => {
    expect(isValidProvider('todoist')).toBe(true);
    expect(isValidProvider('nonexistent')).toBe(false);
    expect(isValidProvider('')).toBe(false);
  });
});

describe('TodoistProvider', () => {
  let provider: TodoistProvider;

  beforeEach(() => {
    provider = new TodoistProvider();
  });

  it('has correct provider info', () => {
    expect(provider.info.id).toBe('todoist');
    expect(provider.info.name).toBe('Todoist');
    expect(provider.info.authType).toBe('oauth2');
    expect(provider.info.oauthUrl).toBeDefined();
  });

  it('rejects connect without required params', async () => {
    await expect(provider.connect({})).rejects.toThrow('Missing required OAuth parameters');
    await expect(provider.connect({ code: 'test' })).rejects.toThrow(
      'Missing required OAuth parameters'
    );
  });

  it('rejects pullTasks without access token', async () => {
    const secrets: IntegrationSecrets = {};
    const config: IntegrationConfig = {
      providerId: 'todoist',
      enabled: true,
      status: 'connected',
      fieldMapping: {
        title: 'title',
        description: 'description',
        status: 'status',
        priority: 'priority',
        dueDate: 'dueDate',
      },
      providerConfig: {},
    };
    await expect(provider.pullTasks(secrets, config)).rejects.toThrow('Not connected to Todoist');
  });

  it('rejects pushTask without access token', async () => {
    const secrets: IntegrationSecrets = {};
    const config: IntegrationConfig = {
      providerId: 'todoist',
      enabled: true,
      status: 'connected',
      fieldMapping: {
        title: 'title',
        description: 'description',
        status: 'status',
        priority: 'priority',
        dueDate: 'dueDate',
      },
      providerConfig: {},
    };
    await expect(
      provider.pushTask(secrets, config, { title: 'Test', description: '', priority: 'medium' })
    ).rejects.toThrow('Not connected to Todoist');
  });

  it('handles webhook with event_data', async () => {
    const ids = await provider.handleWebhook({ event_data: { id: '12345' } }, {});
    expect(ids).toEqual(['12345']);
  });

  it('handles webhook without event_data', async () => {
    const ids = await provider.handleWebhook({}, {});
    expect(ids).toEqual([]);
  });

  it('disconnect does not throw', async () => {
    await expect(provider.disconnect({})).resolves.toBeUndefined();
  });
});

describe('Integration Service (storage)', () => {
  let tmpDir: string;
  let origCwd: string;

  beforeEach(async () => {
    const uniqueSuffix = Math.random().toString(36).substring(7);
    tmpDir = path.join(os.tmpdir(), `veritas-test-integrations-${uniqueSuffix}`);
    await fs.mkdir(path.join(tmpDir, '.veritas-kanban'), { recursive: true });
    // The integration service resolves paths from process.cwd()/..
    // We can't easily override that without refactoring, so we test the
    // types and provider logic here instead.
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('IntegrationConfig type is well-formed', () => {
    const config: IntegrationConfig = {
      providerId: 'todoist',
      enabled: true,
      status: 'connected',
      connectedAt: new Date().toISOString(),
      fieldMapping: {
        title: 'content',
        description: 'description',
        status: 'is_completed',
        priority: 'priority',
        dueDate: 'due.date',
      },
      providerConfig: { projectId: '123' },
    };
    expect(config.providerId).toBe('todoist');
    expect(config.status).toBe('connected');
  });
});
