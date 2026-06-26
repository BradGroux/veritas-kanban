import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';

const mockWithFileLock = vi.fn(async (_path, fn) => await fn());
const mockGetChatsDir = vi.fn();
const mockCreateNotification = vi.fn();
let sessionCounter = 0;
let messageCounter = 0;

vi.mock('../services/file-lock.js', () => ({ withFileLock: mockWithFileLock }));
vi.mock('../utils/paths.js', () => ({ getChatsDir: mockGetChatsDir }));
vi.mock('../services/notification-service.js', () => ({
  getNotificationService: () => ({
    createNotification: mockCreateNotification,
  }),
  parseMentions: (text: string) =>
    Array.from(text.matchAll(/@([a-zA-Z0-9_-]+)/g), (match) => match[1].toLowerCase()).filter(
      (value, index, values) => values.indexOf(value) === index
    ),
}));
vi.mock('nanoid', () => ({
  nanoid: (len?: number) => {
    if (len === 12) return `session${String(++sessionCounter).padStart(5, '0')}`;
    return `message${String(++messageCounter).padStart(4, '0')}`;
  },
}));

describe('ChatService', () => {
  let tmpDir: string;
  let service: any;

  beforeEach(async () => {
    vi.resetModules();
    sessionCounter = 0;
    messageCounter = 0;
    mockCreateNotification.mockResolvedValue({ id: 'notif_1' });
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'chat-service-'));
    mockGetChatsDir.mockReturnValue(tmpDir);
    const mod = await import('../services/chat-service.js');
    service = new mod.ChatService();
    await fs.mkdir(path.join(tmpDir, 'sessions'), { recursive: true });
    await fs.mkdir(path.join(tmpDir, 'squad'), { recursive: true });
  });

  afterEach(async () => {
    vi.clearAllMocks();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('creates board and task sessions, adds messages, and lists newest first', async () => {
    const board = await service.createSession({ agent: 'VERITAS', mode: 'build' });
    const task = await service.createSession({ taskId: '123', agent: 'TARS' });

    expect(board.id).toBe('chat_session00001');
    expect(task.id).toBe('task_123');

    const added = await service.addMessage(board.id, {
      role: 'assistant',
      content: 'Hello',
      model: 'gpt',
    });
    expect(added.id).toBe('msg_message0001');

    const boardReloaded = await service.getSession(board.id);
    expect(boardReloaded.messages[0]).toMatchObject({ role: 'assistant', content: 'Hello' });
    expect(await service.getSessionForTask('123')).toMatchObject({ id: 'task_123' });

    const sessions = await service.listSessions();
    expect(sessions.map((s: any) => s.id)).toContain(board.id);
    expect(sessions.every((s: any) => !s.taskId)).toBe(true);
  });

  it('returns null for missing sessions and errors when adding to unknown session', async () => {
    await expect(service.getSession('chat_missing0001')).resolves.toBeNull();
    await expect(service.getSessionForTask('404')).resolves.toBeNull();
    await expect(
      service.addMessage('chat_missing0001', { role: 'user', content: 'x' })
    ).rejects.toThrow(/not found/);
  });

  it('deletes sessions idempotently', async () => {
    const session = await service.createSession({ agent: 'VERITAS' });
    await service.deleteSession(session.id);
    await expect(service.getSession(session.id)).resolves.toBeNull();
    await expect(service.deleteSession(session.id)).resolves.toBeUndefined();
  });

  it('round-trips squad chat messages with filters, system suppression, and limits', async () => {
    await service.sendSquadMessage(
      {
        agent: 'TARS',
        message: 'start',
        tags: ['testing'],
        model: 'gpt',
        taskTitle: 'Task A',
        duration: '5s',
      },
      'Tars'
    );
    await service.sendSquadMessage({
      agent: 'CASE',
      message: 'system note',
      system: true,
      event: 'agent.status',
      model: 'gpt',
    });

    const date = new Date().toISOString().split('T')[0];
    const squadPath = path.join(tmpDir, 'squad', `${date}.md`);
    const extra = `## Human | msg_manual | 2026-03-01T00:00:00.000Z [model:gpt] [chat]\n\nhello\n\n---\n\n`;
    await fs.appendFile(squadPath, extra, 'utf8');

    const all = await service.getSquadMessages();
    expect(all.map((m: any) => m.id)).toContain('msg_manual');
    expect(
      (await service.getSquadMessages({ includeSystem: false })).some((m: any) => m.system)
    ).toBe(false);
    expect((await service.getSquadMessages({ agent: 'TARS' })).map((m) => m.id)).toEqual([
      'msg_message0001',
    ]);
    expect(
      (await service.getSquadMessages({ since: '2026-03-01T00:00:00.001Z' })).some(
        (m: any) => m.id === 'msg_manual'
      )
    ).toBe(false);
    expect((await service.getSquadMessages({ limit: 1 })).length).toBe(1);
  });

  it('tracks squad threads, mentions, unread state, pins, reactions, and redacted search', async () => {
    const root = await service.sendSquadMessage({
      agent: 'VERITAS',
      message: 'Need @case review. Bearer abcdefghijklmnopqrstuvwxyz1234567890',
      taskId: 'task-1',
    });
    const reply = await service.sendSquadMessage({
      agent: 'CASE',
      message: 'Acknowledged.',
      replyToId: root.id,
      runId: 'run-1',
    });

    expect(root.mentions).toEqual([{ target: 'case', kind: undefined }]);
    expect(root.links).toEqual([{ taskId: 'task-1', label: 'Task task-1' }]);
    expect(reply.threadId).toBe(root.id);
    expect(mockCreateNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        targetAgent: 'case',
        fromAgent: 'VERITAS',
        type: 'squad_mention',
        targetUrl: `/chat/squad?messageId=${root.id}`,
      })
    );

    const thread = await service.getSquadThread(reply.id);
    expect(thread.map((message: any) => message.id)).toEqual([root.id, reply.id]);

    const unread = await service.getSquadUnreadState('case');
    expect(unread.unreadCount).toBeGreaterThanOrEqual(1);
    expect(unread.mentionCount).toBe(1);

    const marked = await service.markSquadRead({ actor: 'case', messageId: root.id });
    expect(marked.lastReadMessageId).toBe(root.id);

    const pinned = await service.updateSquadMessageState(root.id, {
      pinned: true,
      decision: true,
    });
    expect(pinned).toMatchObject({ pinned: true, decision: true });

    const acked = await service.addSquadReaction({
      messageId: root.id,
      actor: 'case',
      reaction: 'ack',
    });
    expect(acked?.reactions).toEqual([expect.objectContaining({ actor: 'case', reaction: 'ack' })]);

    const search = await service.searchSquadMessages({ query: 'review' });
    expect(search.results[0]).toMatchObject({ messageId: root.id, agent: 'VERITAS' });
    expect(search.results[0].snippet).toContain('Bearer [REDACTED]');
    expect(search.results[0].snippet).not.toContain('abcdefghijklmnopqrstuvwxyz1234567890');
  });

  it('handles missing squad/session directories and rejects traversal input', async () => {
    await fs.rm(path.join(tmpDir, 'sessions'), { recursive: true, force: true });
    await fs.rm(path.join(tmpDir, 'squad'), { recursive: true, force: true });
    expect(await service.listSessions()).toEqual([]);
    expect(await service.getSquadMessages()).toEqual([]);

    await expect(service.getSession('../evil')).rejects.toThrow();
    await expect(service.createSession({ taskId: '../evil', agent: 'VERITAS' })).rejects.toThrow();
  });
});
