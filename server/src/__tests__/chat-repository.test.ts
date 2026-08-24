import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, symlink, truncate, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ChatMessage, ChatSession, SquadMessage } from '@veritas-kanban/shared';
import { FileChatRepository } from '../storage/chat-repository.js';
import { SqliteChatRepository } from '../storage/sqlite/chat-repository.js';

function session(id: string, updated = '2026-08-23T00:00:00.000Z'): ChatSession {
  return {
    id,
    title: 'Session',
    messages: [],
    agent: 'VERITAS',
    mode: 'ask',
    created: '2026-08-22T00:00:00.000Z',
    updated,
  };
}

function message(id: string, content: string): ChatMessage {
  return {
    id,
    role: 'assistant',
    content,
    timestamp: `2026-08-23T00:00:0${id.endsWith('2') ? '2' : '1'}.000Z`,
    agent: 'VERITAS',
    model: 'gpt',
  };
}

describe('FileChatRepository', () => {
  let root: string;
  let chatsDir: string;
  let repository: FileChatRepository;

  beforeEach(async () => {
    root = await mkdtemp(path.join(process.cwd(), '.veritas-chat-repository-'));
    chatsDir = path.join(root, 'chats');
    repository = new FileChatRepository(chatsDir);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('round-trips board and task sessions with concurrent atomic appends', async () => {
    await expect(repository.getSession('chat_missing')).resolves.toBeNull();
    await repository.saveSession(session('chat_old'));
    await repository.saveSession(session('chat_new', '2026-08-24T00:00:00.000Z'));
    await repository.saveSession({ ...session('task_123'), taskId: '123' });

    await expect(
      Promise.all([
        repository.appendSessionMessage('chat_new', message('msg_1', 'one')),
        repository.appendSessionMessage('chat_new', message('msg_2', 'two')),
      ])
    ).resolves.toEqual([true, true]);
    await expect(
      repository.appendSessionMessage('chat_missing', message('msg_3', 'x'))
    ).resolves.toBe(false);

    const stored = await repository.getSession('chat_new');
    expect(stored?.messages.map((entry) => entry.content).sort()).toEqual(['one', 'two']);
    const restarted = new FileChatRepository(chatsDir);
    await expect(restarted.getSession('chat_new')).resolves.toMatchObject({
      messages: expect.arrayContaining([
        expect.objectContaining({ content: 'one' }),
        expect.objectContaining({ content: 'two' }),
      ]),
    });
    await expect(repository.getSessionForTask('123')).resolves.toMatchObject({ id: 'task_123' });

    await mkdir(path.join(chatsDir, 'sessions', 'nested.md'));
    await writeFile(path.join(chatsDir, 'sessions', 'ignored.txt'), 'ignored', 'utf8');
    await symlink(
      path.join(chatsDir, 'sessions', 'chat_old.md'),
      path.join(chatsDir, 'sessions', 'alias.md')
    );
    await expect(repository.listBoardSessions()).resolves.toMatchObject([
      { id: 'chat_new' },
      { id: 'chat_old' },
    ]);

    const malformedPath = path.join(chatsDir, 'sessions', 'chat_old.md');
    await writeFile(
      malformedPath,
      `${await readFile(malformedPath, 'utf8')}\n---\nnot a message header\nignored\n`,
      'utf8'
    );
    await expect(repository.getSession('chat_old')).resolves.toMatchObject({ messages: [] });

    await expect(repository.deleteSession('chat_new')).resolves.toBe(true);
    await expect(repository.deleteSession('chat_new')).resolves.toBe(false);

    await mkdir(path.join(chatsDir, 'sessions', 'chat_directory.md'));
    await expect(repository.deleteSession('chat_directory')).rejects.toThrow();
  });

  it('round-trips squad logs, legacy formatting, filters, and metadata', async () => {
    const first: SquadMessage = {
      id: 'msg_first',
      agent: 'TARS',
      displayName: 'Tars',
      message: 'First',
      tags: ['testing', 'chat'],
      timestamp: '2026-08-23T00:00:00.000Z',
      model: 'gpt',
      system: true,
      event: 'agent.status',
      taskTitle: 'Task A',
      duration: '5s',
    };
    const second: SquadMessage = {
      id: 'msg_second',
      agent: 'CASE',
      message: 'Second',
      timestamp: '2026-08-24T00:00:00.000Z',
      duration: '2s',
    };
    await repository.appendSquadMessage(first);
    await repository.appendSquadMessage(second);
    expect(await readFile(path.join(chatsDir, 'squad', '2026-08-23.md'), 'utf8')).toContain(
      'msg_first'
    );

    expect(await repository.listSquadMessages()).toMatchObject([first, second]);
    expect(await repository.listSquadMessages({ includeSystem: false })).toMatchObject([second]);
    expect(await repository.listSquadMessages({ agent: 'CASE' })).toMatchObject([second]);
    expect(
      await repository.listSquadMessages({ since: '2026-08-23T12:00:00.000Z', limit: 1 })
    ).toMatchObject([second]);

    await expect(repository.readSquadMetadata()).resolves.toMatchObject({
      version: 1,
      messages: {},
      reads: {},
    });
    await expect(
      repository.updateSquadMetadata((metadata) => {
        metadata.messages.msg_first = { pinned: true };
        return 'updated';
      })
    ).resolves.toBe('updated');
    await expect(repository.readSquadMetadata()).resolves.toMatchObject({
      messages: { msg_first: { pinned: true } },
    });

    await writeFile(path.join(chatsDir, 'squad', 'metadata.json'), '{}', 'utf8');
    await expect(repository.readSquadMetadata()).resolves.toMatchObject({
      messages: {},
      reads: {},
    });
  });

  it('skips missing and malformed squad log entries', async () => {
    await repository.listSquadMessages();
    const squadPath = path.join(chatsDir, 'squad', '2026-08-23.md');
    await writeFile(
      squadPath,
      [
        '# Squad Chat - 2026-08-23',
        '',
        '## only | two',
        '',
        'ignored',
        '',
        '---',
        '',
        '## | msg_missing_agent | 2026-08-23T00:00:00.000Z',
        '',
        'ignored',
        '',
        '---',
        '',
        '## CASE | msg_missing_timestamp | [system]',
        '',
        'ignored',
        '',
        '---',
        '',
      ].join('\n'),
      'utf8'
    );
    await expect(repository.listSquadMessages()).resolves.toEqual([]);

    const internals = repository as unknown as {
      readOptionalBoundedFile: () => Promise<null>;
    };
    internals.readOptionalBoundedFile = vi.fn(async () => null);
    await expect(repository.listSquadMessages()).resolves.toEqual([]);
  });

  it('rejects traversal, symbolic links, oversized sessions, and invalid squad timestamps', async () => {
    await expect(repository.getSession('../outside')).rejects.toThrow();
    await expect(repository.getSessionForTask('../outside')).rejects.toThrow();
    await expect(
      repository.saveSession({ ...session('chat_large'), title: 'x'.repeat(16 * 1024 * 1024) })
    ).rejects.toThrow(/storage limit/);

    const oversizedPath = path.join(chatsDir, 'sessions', 'chat_oversized.md');
    await writeFile(oversizedPath, '', 'utf8');
    await truncate(oversizedPath, 16 * 1024 * 1024 + 1);
    await expect(repository.getSession('chat_oversized')).rejects.toThrow(/bounded regular file/);
    await expect(repository.getSession('x'.repeat(256))).rejects.toThrow();
    await expect(
      (
        repository as unknown as {
          readOptionalBoundedFile: (
            filePath: string,
            maximumBytes: number,
            label: string
          ) => Promise<string | null>;
        }
      ).readOptionalBoundedFile(path.join(root, 'outside.md'), 1024, 'Chat session')
    ).rejects.toThrow(/outside its repository/);
    await expect(
      repository.appendSquadMessage({
        id: 'msg_invalid',
        agent: 'CASE',
        message: 'invalid',
        timestamp: 'invalid',
      })
    ).rejects.toThrow(/timestamp is invalid/);

    const outside = path.join(root, 'outside.md');
    await writeFile(outside, 'outside', 'utf8');
    const sessionPath = path.join(chatsDir, 'sessions', 'chat_link.md');
    await symlink(outside, sessionPath);
    await expect(repository.getSession('chat_link')).rejects.toThrow(/symbolic link/i);

    const linkedRoot = path.join(root, 'linked-root');
    const target = path.join(root, 'target');
    await mkdir(target);
    await symlink(target, linkedRoot);
    const linkedRepository = new FileChatRepository(linkedRoot);
    await expect(linkedRepository.listBoardSessions()).rejects.toThrow(/regular directories/);
  });
});

describe('SqliteChatRepository append transaction outcomes', () => {
  it('commits a missing-session no-op and rolls back malformed stored state', () => {
    const missingExec = vi.fn();
    const missing = new SqliteChatRepository({
      getConnection: () => ({
        exec: missingExec,
        prepare: () => ({ get: () => undefined }),
      }),
    } as never);

    expect(missing.appendSessionMessage('missing', message('msg_1', 'missing'))).toBe(false);
    expect(missingExec.mock.calls.map(([statement]) => statement)).toEqual([
      'BEGIN IMMEDIATE;',
      'COMMIT;',
    ]);

    const malformedExec = vi.fn();
    const malformed = new SqliteChatRepository({
      getConnection: () => ({
        exec: malformedExec,
        prepare: () => ({ get: () => ({ id: 'chat_broken', session_json: '{' }) }),
      }),
    } as never);

    expect(() =>
      malformed.appendSessionMessage('chat_broken', message('msg_2', 'broken'))
    ).toThrow();
    expect(malformedExec.mock.calls.map(([statement]) => statement)).toEqual([
      'BEGIN IMMEDIATE;',
      'ROLLBACK;',
    ]);
  });
});
