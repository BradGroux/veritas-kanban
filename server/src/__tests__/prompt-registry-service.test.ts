import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';

import { PromptRegistryService } from '../services/prompt-registry-service.js';

describe('PromptRegistryService', () => {
  let tmpDir: string;
  let oldDataDir: string | undefined;
  let service: PromptRegistryService;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'prompt-registry-'));
    oldDataDir = process.env.DATA_DIR;
    process.env.DATA_DIR = tmpDir;
    service = new PromptRegistryService();
  });

  afterEach(async () => {
    if (oldDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = oldDataDir;
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('renders templates and reports unmatched variables', () => {
    const result = service.renderTemplate('Hello {{name}} from {{company}}', { name: 'Brad' });
    expect(result.renderedPrompt).toBe('Hello Brad from {{company}}');
    expect(result.unmatchedVariables).toEqual(['company']);
  });

  it('creates templates, versions, and extracts sorted unique variables', async () => {
    const created = await service.createTemplate({
      name: 'Bug Fix Prompt',
      description: 'Helps fix bugs',
      category: 'engineering',
      content: 'Fix {{ issue }} for {{customer}} with {{ issue }} details',
    } as any);

    expect(created.id).toMatch(/^prompt_bug-fix-prompt_/);
    expect(created.variables).toEqual(['customer', 'issue']);
    expect(await service.getTemplate(created.id)).toMatchObject({
      id: created.id,
      currentVersionId: `${created.id}_v1`,
    });
    expect((await service.getVersionHistory(created.id)).map((v) => v.versionNumber)).toEqual([1]);
  });

  it('creates templates with caller-provided stable IDs', async () => {
    const created = await service.createTemplate({
      id: 'worker-handoff',
      name: 'Worker Handoff',
      category: 'agent',
      content: 'Hand off {{task_id}}',
    });

    expect(created.id).toBe('worker-handoff');
    expect(created.currentVersionId).toBe('worker-handoff_v1');
    expect(await service.getTemplate('worker-handoff')).toMatchObject({
      id: 'worker-handoff',
      name: 'Worker Handoff',
    });
    expect((await service.getVersionHistory('worker-handoff')).map((v) => v.versionNumber)).toEqual(
      [1]
    );
  });

  it('updates metadata without creating a version and creates a new version on content change', async () => {
    const created = await service.createTemplate({
      name: 'Ops Prompt',
      category: 'operations',
      content: 'Deploy {{service}}',
    } as any);

    const renamed = await service.updateTemplate(created.id, { description: 'new desc' } as any);
    expect(renamed?.description).toBe('new desc');
    expect((await service.getVersionHistory(created.id)).map((v) => v.versionNumber)).toEqual([1]);

    await expect(
      service.updateTemplate(created.id, { content: 'Deploy {{service}} safely' } as any)
    ).rejects.toThrow(/changelog is required/);

    const updated = await service.updateTemplate(created.id, {
      content: 'Deploy {{service}} safely for {{env}}',
      changelog: 'Add env variable',
    } as any);
    expect(updated?.variables).toEqual(['env', 'service']);
    expect(updated?.currentVersionId).toBe(`${created.id}_v2`);
    expect((await service.getVersionHistory(created.id)).map((v) => v.versionNumber)).toEqual([
      2, 1,
    ]);
  });

  it('records usage, returns stats, and sorts all stats by usage count', async () => {
    const first = await service.createTemplate({
      name: 'One',
      category: 'engineering',
      content: 'Hi {{name}}',
    } as any);
    const second = await service.createTemplate({
      name: 'Two',
      category: 'engineering',
      content: 'Bye {{name}}',
    } as any);

    await service.recordUsage(first.id, 'brad', 'Hi Brad', 'gpt', 10, 5);
    await service.recordUsage(first.id, 'brad', 'Hi Again', 'gpt', 20, 10);
    await service.recordUsage(second.id, 'ava', 'Bye Ava', 'gpt', 5, 5);

    const stats = await service.getStats(first.id);
    expect(stats).toMatchObject({
      templateId: first.id,
      totalUsages: 2,
      totalVersions: 1,
      mostFrequentUser: 'brad',
      averageTokensPerUsage: 22.5,
    });
    expect(await service.getUsageRecords(first.id)).toHaveLength(2);
    expect((await service.getAllStats()).map((s) => s.templateId)).toEqual([first.id, second.id]);
  });

  it('renders preview, handles missing templates, and deletes template/version/usage files', async () => {
    const created = await service.createTemplate({
      name: 'Preview',
      category: 'engineering',
      content: 'Hey {{name}}',
    } as any);
    await service.recordUsage(created.id, 'brad');

    const preview = await service.renderPreview({
      templateId: created.id,
      sampleVariables: { name: 'Brad' },
    } as any);
    expect(preview.renderedPrompt).toBe('Hey Brad');
    await expect(
      service.renderPreview({ templateId: 'missing', sampleVariables: {} } as any)
    ).rejects.toThrow(/not found/);

    expect(await service.deleteTemplate(created.id)).toBe(true);
    expect(await service.deleteTemplate(created.id)).toBe(false);
    expect(await service.getTemplate(created.id)).toBeNull();
  });

  it('skips unreadable files and returns safe fallbacks', async () => {
    const templatesDir = path.join(tmpDir, '.veritas-kanban', 'prompt-templates');
    const versionsDir = path.join(tmpDir, '.veritas-kanban', 'prompt-versions');
    const usageDir = path.join(tmpDir, '.veritas-kanban', 'prompt-usage');
    await fs.mkdir(templatesDir, { recursive: true });
    await fs.mkdir(versionsDir, { recursive: true });
    await fs.mkdir(usageDir, { recursive: true });
    await fs.writeFile(path.join(templatesDir, 'bad.md'), '---\n: bad\n', 'utf8');
    await fs.writeFile(path.join(versionsDir, 'bad_v1.md'), '---\n: bad\n', 'utf8');
    await fs.writeFile(path.join(usageDir, 'bad.json'), '{bad', 'utf8');

    expect(await service.getTemplates()).toEqual([]);
    expect(await service.getTemplate('missing')).toBeNull();
    expect(await service.getVersionHistory('bad')).toEqual([{}]);
    expect(await service.getUsageRecords('bad')).toEqual([]);
    expect(await service.getStats('missing')).toBeNull();
  });
});
