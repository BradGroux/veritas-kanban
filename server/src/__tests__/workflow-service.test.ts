import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';

import { WorkflowService } from '../services/workflow-service.js';
import { ValidationError, type WorkflowDefinition } from '../types/workflow.js';

function workflow(overrides: Record<string, any> = {}) {
  return {
    id: 'demo-workflow',
    name: 'Demo Workflow',
    version: 1,
    description: 'A workflow for tests',
    variables: { project: 'demo' },
    agents: [{ id: 'agent-1', name: 'Agent 1', model: 'x' }],
    steps: [{ id: 'step-1', type: 'agent', agent: 'agent-1', prompt: 'Do thing' }],
    ...overrides,
  };
}

describe('WorkflowService', () => {
  let tmpDir: string;
  let service: WorkflowService;
  let originalCodexEnv: {
    VERITAS_CODEX_EXECUTABLE?: string;
    CODEX_PATH?: string;
    VERITAS_ALLOW_UNSAFE_CODEX_COMMAND_OVERRIDES?: string;
  };

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'workflow-service-'));
    service = new WorkflowService(tmpDir);
    originalCodexEnv = {
      VERITAS_CODEX_EXECUTABLE: process.env.VERITAS_CODEX_EXECUTABLE,
      CODEX_PATH: process.env.CODEX_PATH,
      VERITAS_ALLOW_UNSAFE_CODEX_COMMAND_OVERRIDES:
        process.env.VERITAS_ALLOW_UNSAFE_CODEX_COMMAND_OVERRIDES,
    };
    delete process.env.VERITAS_CODEX_EXECUTABLE;
    delete process.env.CODEX_PATH;
    delete process.env.VERITAS_ALLOW_UNSAFE_CODEX_COMMAND_OVERRIDES;
  });

  afterEach(async () => {
    for (const [key, value] of Object.entries(originalCodexEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('saves, loads, caches, and clears cached workflows', async () => {
    const wf = workflow();
    await service.saveWorkflow(wf as any);

    const loaded = await service.loadWorkflow('demo-workflow');
    expect(loaded).toMatchObject({ id: 'demo-workflow', name: 'Demo Workflow' });

    const filePath = path.join(tmpDir, 'demo-workflow.yml');
    const rewritten = (await fs.readFile(filePath, 'utf8')).replace(
      'Demo Workflow',
      'Changed Name'
    );
    await fs.writeFile(filePath, rewritten, 'utf8');

    expect((await service.loadWorkflow('demo-workflow'))?.name).toBe('Demo Workflow');
    service.clearCache();
    expect((await service.loadWorkflow('demo-workflow'))?.name).toBe('Changed Name');
  });

  it('lists workflow definitions and metadata from valid workflow files', async () => {
    await service.saveWorkflow(workflow() as any);
    await service.saveWorkflow(
      workflow({
        id: 'second',
        name: 'Second',
        steps: [{ id: 'step-1', type: 'agent', agent: 'agent-1', prompt: 'x' }],
      }) as any
    );

    expect((await service.listWorkflows()).map((w) => w.id).sort()).toEqual([
      'demo-workflow',
      'second',
    ]);
    expect((await service.listWorkflowsMetadata()).map((w) => w.id).sort()).toEqual([
      'demo-workflow',
      'second',
    ]);
  });

  it('deletes workflows and returns null for missing files', async () => {
    await service.saveWorkflow(workflow() as any);
    await service.deleteWorkflow('demo-workflow');
    await expect(service.loadWorkflow('demo-workflow')).resolves.toBeNull();
  });

  it('validates workflow ids and schema limits', async () => {
    await expect(service.loadWorkflow('../bad')).rejects.toThrow(/illegal path characters/);
    await expect(service.saveWorkflow(workflow({ id: ' bad ' }) as any)).rejects.toThrow(
      ValidationError
    );
    await expect(service.saveWorkflow(workflow({ agents: [] }) as any)).rejects.toThrow(
      /at least one agent/
    );
    await expect(service.saveWorkflow(workflow({ steps: [] }) as any)).rejects.toThrow(
      /at least one step/
    );
    await expect(
      service.saveWorkflow(
        workflow({
          agents: [
            { id: 'dup', name: 'A' },
            { id: 'dup', name: 'B' },
          ],
        }) as any
      )
    ).rejects.toThrow(/Duplicate agent IDs/);
    await expect(
      service.saveWorkflow(
        workflow({
          steps: [
            { id: 'dup', type: 'agent', agent: 'agent-1', prompt: 'a' },
            { id: 'dup', type: 'agent', agent: 'agent-1', prompt: 'b' },
          ],
        }) as any
      )
    ).rejects.toThrow(/Duplicate step IDs/);
    await expect(
      service.saveWorkflow(
        workflow({ steps: [{ id: 'step-1', type: 'agent', agent: 'missing', prompt: 'x' }] }) as any
      )
    ).rejects.toThrow(/unknown agent/);
    await expect(
      service.saveWorkflow(
        workflow({
          steps: [
            {
              id: 'step-1',
              type: 'agent',
              agent: 'agent-1',
              prompt: 'x',
              on_fail: { retry_step: 'missing' },
            },
          ],
        }) as any
      )
    ).rejects.toThrow(/retry_step references unknown step/);
    await expect(
      service.saveWorkflow(
        workflow({
          steps: [
            {
              id: 'step-1',
              type: 'loop',
              agent: 'agent-1',
              prompt: 'x',
              loop: { verify_step: 'missing' },
            },
          ],
        }) as any
      )
    ).rejects.toThrow(/verify_step references unknown step/);
    await expect(
      service.saveWorkflow(
        workflow({
          steps: [
            {
              id: 'step-1',
              type: 'agent',
              agent: 'agent-1',
              prompt: 'x',
              on_fail: { retry_delay_ms: -1 },
            },
          ],
        }) as any
      )
    ).rejects.toThrow(/cannot be negative/);
    await expect(
      service.saveWorkflow(
        workflow({
          steps: [
            {
              id: 'step-1',
              type: 'agent',
              agent: 'agent-1',
              prompt: 'x',
              on_fail: { retry_delay_ms: 300001 },
            },
          ],
        }) as any
      )
    ).rejects.toThrow(/exceeds maximum/);
    await expect(service.saveWorkflow(workflow({ name: 'x'.repeat(201) }) as any)).rejects.toThrow(
      /name exceeds maximum/
    );
    await expect(
      service.saveWorkflow(workflow({ description: 'x'.repeat(2001) }) as any)
    ).rejects.toThrow(/description exceeds maximum/);
    await expect(
      service.saveWorkflow(
        workflow({
          agents: [
            { id: 'agent-1', name: 'A', tools: Array.from({ length: 51 }, (_, i) => `t${i}`) },
          ],
        }) as any
      )
    ).rejects.toThrow(/exceeds maximum of 50 tools/);
  });

  it('rejects arbitrary Codex command overrides unless explicitly allowlisted', async () => {
    const codexWorkflow = workflow({
      agents: [
        {
          id: 'codex',
          name: 'Codex',
          role: 'developer',
          provider: 'codex-sdk',
          command: '/tmp/not-the-codex-binary',
          description: 'Runs Codex.',
        },
      ],
      steps: [{ id: 'step-1', type: 'agent', agent: 'codex', prompt: 'x' }],
    }) as WorkflowDefinition;

    await expect(service.saveWorkflow(codexWorkflow)).rejects.toThrow(
      /unsafe Codex command override/
    );

    process.env.VERITAS_CODEX_EXECUTABLE = '/tmp/not-the-codex-binary';
    await expect(service.saveWorkflow(codexWorkflow)).resolves.toBeUndefined();
  });

  it('saves ACLs and audit entries', async () => {
    await service.saveACL({
      workflowId: 'wf-1',
      allowedUsers: ['u1'],
      allowedRoles: ['admin'],
    } as any);
    expect(await service.loadACL('wf-1')).toEqual({
      workflowId: 'wf-1',
      allowedUsers: ['u1'],
      allowedRoles: ['admin'],
    });
    expect(await service.loadACL('missing')).toBeNull();

    await service.auditChange({
      workflowId: 'wf-1',
      action: 'updated',
      userId: 'u1',
      timestamp: '2026-03-01T00:00:00.000Z',
    } as any);
    const audit = await fs.readFile(path.join(tmpDir, '.audit.jsonl'), 'utf8');
    expect(audit).toContain('"workflowId":"wf-1"');
  });
});
