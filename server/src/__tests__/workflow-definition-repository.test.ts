import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, symlink, truncate, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { WorkflowACL, WorkflowAuditEvent, WorkflowDefinition } from '../types/workflow.js';
import { FileWorkflowDefinitionRepository } from '../storage/workflow-definition-repository.js';

function workflow(id: string): WorkflowDefinition {
  return {
    id,
    name: `Workflow ${id}`,
    version: 1,
    agents: [{ id: 'agent-1', name: 'Agent One', role: 'developer' }],
    steps: [{ id: 'step-1', type: 'agent', agent: 'agent-1', input: 'Do the work.' }],
  };
}

function acl(workflowId: string): WorkflowACL {
  return {
    workflowId,
    owner: 'brad',
    editors: ['brad'],
    viewers: [],
    executors: [],
    isPublic: false,
  };
}

describe('FileWorkflowDefinitionRepository', () => {
  let root: string;
  let workflowsDir: string;
  let repository: FileWorkflowDefinitionRepository;

  beforeEach(async () => {
    root = await mkdtemp(path.join(process.cwd(), '.veritas-workflow-repository-'));
    workflowsDir = path.join(root, 'workflows');
    repository = new FileWorkflowDefinitionRepository(workflowsDir);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('atomically persists, lists, and deletes workflow definitions', async () => {
    await expect(repository.get('missing')).resolves.toBeNull();
    await expect(repository.getAcl('missing')).resolves.toBeNull();
    await repository.save(workflow('alpha'));

    await expect(repository.get('alpha')).resolves.toMatchObject({ id: 'alpha' });
    await expect(repository.count()).resolves.toBe(1);
    await expect(repository.listMetadata()).resolves.toEqual([
      { id: 'alpha', name: 'Workflow alpha', version: 1, description: '' },
    ]);

    await expect(repository.delete('alpha')).resolves.toBe(true);
    await expect(repository.delete('alpha')).resolves.toBe(false);
  });

  it('loads both supported YAML extensions and skips invalid metadata', async () => {
    await mkdir(workflowsDir, { recursive: true });
    await writeFile(
      path.join(workflowsDir, 'legacy.yaml'),
      [
        'id: legacy',
        'name: Legacy Workflow',
        'version: 1',
        'agents:',
        '  - id: agent-1',
        '    name: Agent One',
        'steps:',
        '  - id: step-1',
        '    type: agent',
        '    agent: agent-1',
      ].join('\n'),
      'utf8'
    );
    await writeFile(path.join(workflowsDir, 'broken.yml'), ': invalid', 'utf8');

    await expect(repository.listMetadata()).resolves.toEqual([
      { id: 'legacy', name: 'Legacy Workflow', version: 1, description: '' },
    ]);
  });

  it('serializes concurrent ACL updates and appends audit events', async () => {
    await Promise.all([repository.saveAcl(acl('alpha')), repository.saveAcl(acl('beta'))]);
    await expect(repository.getAcl('alpha')).resolves.toMatchObject({ workflowId: 'alpha' });
    await expect(repository.getAcl('beta')).resolves.toMatchObject({ workflowId: 'beta' });

    const event: WorkflowAuditEvent = {
      timestamp: '2026-08-23T21:00:00.000Z',
      userId: 'brad',
      action: 'edit',
      workflowId: 'alpha',
      workflowVersion: 1,
    };
    await repository.appendAuditEvent(event);
    await expect(readFile(path.join(workflowsDir, '.audit.jsonl'), 'utf8')).resolves.toBe(
      `${JSON.stringify(event)}\n`
    );
  });

  it('rejects symbolic-link files and parent directories', async () => {
    await mkdir(workflowsDir, { recursive: true });
    const target = path.join(root, 'outside.yml');
    await writeFile(target, 'id: linked', 'utf8');
    await symlink(target, path.join(workflowsDir, 'linked.yml'));
    await expect(repository.get('linked')).rejects.toThrow(/symbolic link/i);

    const realDirectory = path.join(root, 'real-workflows');
    const linkedDirectory = path.join(root, 'linked-workflows');
    await mkdir(realDirectory);
    await symlink(realDirectory, linkedDirectory, 'dir');
    const linkedRepository = new FileWorkflowDefinitionRepository(linkedDirectory);
    await expect(linkedRepository.save(workflow('unsafe'))).rejects.toThrow(/regular directory/i);
  });

  it('rejects non-file, oversized, and linked persistence targets', async () => {
    await mkdir(workflowsDir, { recursive: true });
    const invalidWorkflowPath = path.join(workflowsDir, 'invalid.yml');
    await mkdir(invalidWorkflowPath);
    await expect(repository.get('invalid')).rejects.toThrow(/bounded regular file/i);
    await expect(repository.delete('invalid')).rejects.toThrow();
    await rm(invalidWorkflowPath, { recursive: true });

    await expect(
      repository.save({ ...workflow('oversized'), description: 'x'.repeat(2 * 1024 * 1024) })
    ).rejects.toThrow(/storage limit/i);

    const auditPath = path.join(workflowsDir, '.audit.jsonl');
    await writeFile(auditPath, '', 'utf8');
    await truncate(auditPath, 64 * 1024 * 1024);
    const event: WorkflowAuditEvent = {
      timestamp: '2026-08-23T21:00:00.000Z',
      userId: 'brad',
      action: 'edit',
      workflowId: 'alpha',
      workflowVersion: 1,
    };
    await expect(repository.appendAuditEvent(event)).rejects.toThrow(/bounded regular file/i);

    await rm(auditPath);
    const auditTarget = path.join(root, 'outside-audit.jsonl');
    await writeFile(auditTarget, '', 'utf8');
    await symlink(auditTarget, auditPath);
    await expect(repository.appendAuditEvent(event)).rejects.toThrow(/symbolic link/i);
  });
});
