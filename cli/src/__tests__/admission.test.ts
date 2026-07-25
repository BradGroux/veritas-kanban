import { Command } from 'commander';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => vi.fn());

vi.mock('../utils/api.js', () => ({ api }));

import { registerAdmissionCommands } from '../commands/admission.js';

describe('vk admission commands', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.exitCode = 0;
  });

  it('lists reservations as JSON with all operator filters preserved', async () => {
    api.mockResolvedValue({
      generatedAt: '2026-07-25T10:00:00.000Z',
      reservations: [{ id: 'admission_1', state: 'active' }],
    });
    const output = vi.spyOn(console, 'log').mockImplementation(() => {});
    const program = new Command().exitOverride();
    registerAdmissionCommands(program);

    await program.parseAsync([
      'node',
      'vk',
      'admission',
      'list',
      '--workspace',
      'workspace-a',
      '--state',
      'active',
      'released',
      '--limit',
      '25',
      '--json',
    ]);

    expect(api).toHaveBeenCalledWith(
      '/api/admission?workspaceId=workspace-a&state=active&state=released&limit=25'
    );
    expect(JSON.parse(String(output.mock.calls[0][0]))).toEqual({
      generatedAt: '2026-07-25T10:00:00.000Z',
      reservations: [{ id: 'admission_1', state: 'active' }],
    });
    output.mockRestore();
  });

  it('inspects one reservation as JSON', async () => {
    api.mockResolvedValue({ id: 'admission_1', state: 'released' });
    const output = vi.spyOn(console, 'log').mockImplementation(() => {});
    const program = new Command().exitOverride();
    registerAdmissionCommands(program);

    await program.parseAsync(['node', 'vk', 'admission', 'get', 'admission_1', '--json']);

    expect(api).toHaveBeenCalledWith('/api/admission/admission_1');
    expect(JSON.parse(String(output.mock.calls[0][0]))).toEqual({
      id: 'admission_1',
      state: 'released',
    });
    output.mockRestore();
  });
});
