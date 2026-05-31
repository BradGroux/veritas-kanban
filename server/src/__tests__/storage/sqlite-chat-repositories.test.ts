import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ChatService } from '../../services/chat-service.js';
import {
  createTestSqliteDatabase,
  type TestSqliteDatabase,
} from '../../storage/sqlite/test-helpers.js';

describe('SQLite chat repositories', () => {
  let fixture: TestSqliteDatabase;
  let testRoot: string;

  beforeEach(async () => {
    fixture = createTestSqliteDatabase();
    fixture.database.open();
    testRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'veritas-sqlite-chat-'));
  });

  afterEach(async () => {
    fixture.cleanup();
    await fs.rm(testRoot, { recursive: true, force: true });
  });

  it('persists board chat, task chat, and squad chat without markdown files', async () => {
    const chatsDir = path.join(testRoot, 'storage', 'chats');
    const service = new ChatService({
      chatsDir,
      storageType: 'sqlite',
      sqliteDatabase: fixture.database,
    });

    const board = await service.createSession({ agent: 'VERITAS', mode: 'build' });
    const task = await service.createSession({ taskId: 'TASK-1', agent: 'TARS' });

    await service.addMessage(board.id, {
      role: 'user',
      content: 'Review the board',
      model: 'gpt-5',
    });
    await service.addMessage(task.id, {
      role: 'assistant',
      content: 'Task scoped reply',
      agent: 'TARS',
    });
    await service.sendSquadMessage(
      {
        agent: 'TARS',
        message: 'Task started',
        tags: ['task'],
        model: 'claude-sonnet-4',
        taskTitle: 'TASK-1',
        duration: '2s',
        card: { type: 'AdaptiveCard' },
      },
      'Tars'
    );
    await service.sendSquadMessage({
      agent: 'CASE',
      message: 'System note',
      system: true,
      event: 'agent.status',
    });

    const restarted = new ChatService({
      chatsDir,
      storageType: 'sqlite',
      sqliteDatabase: fixture.database,
    });

    expect(await restarted.getSession(board.id)).toMatchObject({
      id: board.id,
      messages: [expect.objectContaining({ role: 'user', content: 'Review the board' })],
    });
    expect(await restarted.getSessionForTask('TASK-1')).toMatchObject({
      id: task.id,
      taskId: 'TASK-1',
      messages: [expect.objectContaining({ role: 'assistant', content: 'Task scoped reply' })],
    });
    expect((await restarted.listSessions()).map((session) => session.id)).toEqual([board.id]);

    const squadMessages = await restarted.getSquadMessages();
    expect(squadMessages).toHaveLength(2);
    expect(squadMessages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          agent: 'TARS',
          displayName: 'Tars',
          tags: ['task'],
          card: { type: 'AdaptiveCard' },
        }),
        expect.objectContaining({ agent: 'CASE', system: true, event: 'agent.status' }),
      ])
    );
    expect(await restarted.getSquadMessages({ agent: 'TARS' })).toEqual([
      expect.objectContaining({ agent: 'TARS', message: 'Task started' }),
    ]);
    expect(await restarted.getSquadMessages({ includeSystem: false })).toEqual([
      expect.objectContaining({ agent: 'TARS' }),
    ]);
    expect(await restarted.getSquadMessages({ limit: 1 })).toHaveLength(1);

    await restarted.deleteSession(board.id);
    expect(await restarted.getSession(board.id)).toBeNull();
    await expect(fs.access(chatsDir)).rejects.toThrow();
  });
});
