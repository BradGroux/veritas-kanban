import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetTask = vi.fn();
const mockUpdateTask = vi.fn();
const mockDiff = vi.fn();
const mockStartThread = vi.fn();
const mockRunStreamed = vi.fn();
const mockCodexConstructorOptions = vi.fn();

vi.mock('../services/task-service.js', () => ({
  TaskService: class {
    getTask = mockGetTask;
    updateTask = mockUpdateTask;
  },
}));

vi.mock('simple-git', () => ({
  simpleGit: () => ({
    diff: mockDiff,
  }),
}));

vi.mock('@openai/codex-sdk', () => ({
  Codex: class {
    constructor(options: unknown) {
      mockCodexConstructorOptions(options);
    }

    startThread = mockStartThread;
  },
}));

import { CodexReviewService } from '../services/codex-review-service.js';

async function* reviewEvents() {
  yield { type: 'thread.started', thread_id: 'thread_review_123' };
  yield {
    type: 'item.completed',
    item: {
      id: 'item_1',
      type: 'agent_message',
      text: JSON.stringify({
        decision: 'approved',
        summary: 'No blocking findings.',
        findings: [],
      }),
    },
  };
}

describe('CodexReviewService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetTask.mockResolvedValue({
      id: 'task_1',
      title: 'Review task',
      git: {
        worktreePath: '/tmp/review-worktree',
        baseBranch: 'main',
      },
      comments: [],
      reviewComments: [],
    });
    mockUpdateTask.mockResolvedValue({});
    mockDiff.mockResolvedValue('diff --git a/file.ts b/file.ts\n+change');
    mockRunStreamed.mockResolvedValue({ events: reviewEvents() });
    mockStartThread.mockReturnValue({ runStreamed: mockRunStreamed });
  });

  it('passes only a minimal environment to Codex review sessions', async () => {
    const originalEnv = {
      GITHUB_TOKEN: process.env.GITHUB_TOKEN,
      DATABASE_URL: process.env.DATABASE_URL,
      VERITAS_ADMIN_KEY: process.env.VERITAS_ADMIN_KEY,
      OPENAI_API_KEY: process.env.OPENAI_API_KEY,
      VK_API_URL: process.env.VK_API_URL,
    };
    process.env.GITHUB_TOKEN = 'test-github-token';
    process.env.DATABASE_URL = 'postgres://test-secret';
    process.env.VERITAS_ADMIN_KEY = 'test-admin-key';
    process.env.OPENAI_API_KEY = 'test-openai-key';
    process.env.VK_API_URL = 'http://127.0.0.1:3001';

    try {
      const service = new CodexReviewService();
      await service.reviewTask({ taskId: 'task_1', save: false });

      const env = (
        mockCodexConstructorOptions.mock.calls.at(-1)?.[0] as {
          env?: Record<string, string>;
        }
      ).env;
      expect(env).toMatchObject({
        OPENAI_API_KEY: 'test-openai-key',
        VK_API_URL: 'http://127.0.0.1:3001',
      });
      expect(env?.GITHUB_TOKEN).toBeUndefined();
      expect(env?.DATABASE_URL).toBeUndefined();
      expect(env?.VERITAS_ADMIN_KEY).toBeUndefined();
    } finally {
      for (const [key, value] of Object.entries(originalEnv)) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    }
  });
});
