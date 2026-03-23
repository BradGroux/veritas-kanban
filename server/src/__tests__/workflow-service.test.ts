import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { WorkflowService } from '../services/workflow-service.js';
import type { WorkflowDefinition } from '../types/workflow.js';

describe('WorkflowService', () => {
  const originalCwd = process.cwd();
  let tempDir: string;
  let service: WorkflowService;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'vk-workflow-'));
    process.chdir(tempDir);
    // When testing singletons or services that resolve paths via process.cwd(),
    // mock the module or force resolution so they use our temp dir.
    // Vitest provides vi.resetModules() / vi.doMock() but since WorkflowService
    // constructor calls ensureDirectories using getWorkflowsDir, which relies
    // on getRuntimeDir -> getStorageRoot -> getProjectRoot, we should mock
    // those if needed. However, getProjectRoot falls back to process.cwd(),
    // but the findUp logic might find the actual project root!
    // Let's set the process.env.DATA_DIR to our temp directory to force it
    // exactly without relying on process.cwd() fallback logic from findUp.
    process.env.DATA_DIR = tempDir;
    service = new WorkflowService();
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    delete process.env.DATA_DIR;
    await rm(tempDir, { recursive: true, force: true });
  });

  const validWorkflow: WorkflowDefinition = {
    id: 'test-workflow',
    name: 'Test Workflow',
    version: 1,
    description: 'A test workflow',
    agents: [
      { id: 'agent1', name: 'Agent 1', role: 'developer', description: 'Test agent' }
    ],
    steps: [
      {
        id: 'step1',
        name: 'Step 1',
        type: 'agent',
        agent: 'agent1',
        input: 'Do something'
      }
    ]
  };

  it('saves and loads a workflow', async () => {
    await service.saveWorkflow(validWorkflow);

    // Clear cache to force loading from disk
    service.clearCache();

    const loaded = await service.loadWorkflow('test-workflow');
    expect(loaded).toEqual(validWorkflow);
  });

  it('returns null when loading a non-existent workflow', async () => {
    const loaded = await service.loadWorkflow('non-existent');
    expect(loaded).toBeNull();
  });

  it('lists all workflows', async () => {
    await service.saveWorkflow(validWorkflow);

    const workflow2 = { ...validWorkflow, id: 'test-workflow-2' };
    await service.saveWorkflow(workflow2);

    const list = await service.listWorkflows();
    expect(list).toHaveLength(2);
    expect(list.map(w => w.id)).toContain('test-workflow');
    expect(list.map(w => w.id)).toContain('test-workflow-2');
  });

  it('lists workflow metadata', async () => {
    // Clean directory first to ensure only one workflow exists
    const fs = await import('fs/promises');
    const path = await import('path');
    const workflowsDir = path.join(tempDir, '.veritas-kanban', 'workflows');
    const files = await fs.readdir(workflowsDir).catch(() => []);
    for (const file of files) {
      if (file.endsWith('.yml')) await fs.unlink(path.join(workflowsDir, file));
    }

    await service.saveWorkflow(validWorkflow);

    const list = await service.listWorkflowsMetadata();
    expect(list).toHaveLength(1);
    expect(list[0]).toEqual({
      id: validWorkflow.id,
      name: validWorkflow.name,
      version: validWorkflow.version,
      description: validWorkflow.description
    });
  });

  it('deletes a workflow', async () => {
    await service.saveWorkflow(validWorkflow);
    await service.deleteWorkflow('test-workflow');

    const loaded = await service.loadWorkflow('test-workflow');
    expect(loaded).toBeNull();
  });

  it('saves and loads ACL', async () => {
    // ensure dir exists, because saveACL assumes the folder is there
    const fs = await import('fs/promises');
    const path = await import('path');
    await fs.mkdir(path.join(tempDir, '.veritas-kanban', 'workflows'), { recursive: true });

    const acl = {
      workflowId: 'test-workflow',
      owner: 'user1',
      editors: ['user2'],
      viewers: ['user3'],
      executors: ['user4'],
      isPublic: false
    };

    await service.saveACL(acl);
    const loaded = await service.loadACL('test-workflow');
    expect(loaded).toEqual(acl);
  });

  it('returns null for non-existent ACL', async () => {
    const loaded = await service.loadACL('non-existent');
    expect(loaded).toBeNull();
  });

  it('audits a change', async () => {
    // ensure dir exists, because auditChange assumes the folder is there
    const fs = await import('fs/promises');
    const path = await import('path');
    await fs.mkdir(path.join(tempDir, '.veritas-kanban', 'workflows'), { recursive: true });

    const event = {
      timestamp: new Date().toISOString(),
      userId: 'user1',
      action: 'create' as const,
      workflowId: 'test-workflow'
    };

    await service.auditChange(event);

    // Check if file was created and can be read (manual check using fs in test)
    const auditPath = path.join(tempDir, '.veritas-kanban', 'workflows', '.audit.jsonl');

    const content = await fs.readFile(auditPath, 'utf-8');
    expect(JSON.parse(content.trim())).toEqual(event);
  });

  it('validates workflow on save', async () => {
    const invalidWorkflow = {
      id: 'invalid/id',
      name: 'Invalid Workflow',
      version: 1,
      description: 'An invalid workflow',
      agents: [],
      steps: []
    } as any;

    await expect(service.saveWorkflow(invalidWorkflow)).rejects.toThrow('Workflow ID contains illegal path characters');
  });
});
