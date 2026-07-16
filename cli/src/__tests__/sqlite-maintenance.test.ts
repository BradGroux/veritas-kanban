import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Command } from 'commander';
import { registerSqliteCommands } from '../commands/sqlite.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('vk sqlite journal', () => {
  const originalFetch = globalThis.fetch;
  const originalExitCode = process.exitCode;

  beforeEach(() => {
    vi.restoreAllMocks();
    process.exitCode = undefined;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    process.exitCode = originalExitCode;
  });

  function program(): Command {
    const command = new Command();
    command.exitOverride();
    registerSqliteCommands(command);
    return command;
  }

  it('previews the exact target and emits stable JSON without ANSI output', async () => {
    const preview = {
      schemaVersion: 'sqlite-journal-preview/v1',
      id: '98af3a58-1b8b-41b3-8162-dfdb1f257740',
      token: 'a'.repeat(64),
      createdAt: '2026-07-15T00:00:00.000Z',
      expiresAt: '2026-07-15T00:15:00.000Z',
      targetMode: 'delete',
      currentMode: 'wal',
      databaseLocation: 'configured',
      filesystemType: 'apfs',
      filesystemPosture: 'supported-local',
      ownershipState: 'server-open',
      activeConnectionCount: 4,
      sidecars: [],
      backupLocation: 'adjacent-secure-directory',
      singleHost: true,
      overrideRequired: true,
      risks: ['restart required'],
      restartRequired: true,
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ role: 'admin', isLocalhost: false, permissions: ['*'] })
      )
      .mockResolvedValueOnce(jsonResponse(preview));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const output = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await program().parseAsync(
      [
        'sqlite',
        'journal',
        'preview',
        '--target',
        'delete',
        '--single-host',
        '--override-reason',
        'Approved rollback mode',
        '--expires-at',
        '2026-07-16T00:00:00.000Z',
        '--json',
      ],
      { from: 'user' }
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toBe(
      'http://localhost:3001/api/maintenance/sqlite/journal/preview'
    );
    const request = fetchMock.mock.calls[1][1] as RequestInit;
    expect(JSON.parse(String(request.body))).toEqual({
      targetMode: 'delete',
      singleHost: true,
      overrideReason: 'Approved rollback mode',
      expiresAt: '2026-07-16T00:00:00.000Z',
    });
    const rendered = String(output.mock.calls[0][0]);
    expect(JSON.parse(rendered)).toEqual(preview);
    expect(rendered).not.toContain(String.fromCharCode(27));
  });

  it('refuses apply locally without matching confirmation and acknowledgement', async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await program().parseAsync(
      [
        'sqlite',
        'journal',
        'apply',
        '--preview-id',
        '98af3a58-1b8b-41b3-8162-dfdb1f257740',
        '--preview-token',
        'a'.repeat(64),
        '--confirm',
        '60f2dd7e-35e8-4630-b0cc-687a4c013677',
      ],
      { from: 'user' }
    );

    expect(fetchMock).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });
});
