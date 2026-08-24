import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ChatMessage, ChatSession, SquadMessage } from '@veritas-kanban/shared';
import { FileChatRepository } from '../storage/chat-repository.js';

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
    await expect(repository.listBoardSessions()).resolves.toMatchObject([
      { id: 'chat_new' },
      { id: 'chat_old' },
    ]);

    await expect(repository.deleteSession('chat_new')).resolves.toBe(true);
    await expect(repository.deleteSession('chat_new')).resolves.toBe(false);
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

  it('rejects traversal, symbolic links, oversized sessions, and invalid squad timestamps', async () => {
    await expect(repository.getSession('../outside')).rejects.toThrow();
    await expect(repository.getSessionForTask('../outside')).rejects.toThrow();
    await expect(
      repository.saveSession({ ...session('chat_large'), title: 'x'.repeat(16 * 1024 * 1024) })
    ).rejects.toThrow(/storage limit/);
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
