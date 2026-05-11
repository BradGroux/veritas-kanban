import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { errorHandler } from '../../middleware/error-handler.js';

const { mockGithubService } = vi.hoisted(() => ({
  mockGithubService: {
    checkGhCli: vi.fn(),
    createPR: vi.fn(),
    openPRInBrowser: vi.fn(),
    delegateToCodexCloud: vi.fn(),
  },
}));

vi.mock('../../services/github-service.js', () => ({
  GitHubService: function () {
    return mockGithubService;
  },
}));

vi.mock('../../services/github-sync-service.js', () => ({
  getGitHubSyncService: () => ({
    sync: vi.fn(),
    getSyncState: vi.fn(),
    getConfig: vi.fn(),
    updateConfig: vi.fn(),
  }),
}));

import githubRoutes from '../../routes/github.js';

describe('GitHub Codex Cloud routes', () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = express();
    app.use(express.json());
    app.use('/api/github', githubRoutes);
    app.use(errorHandler);
  });

  it('delegates a task to Codex Cloud through GitHub', async () => {
    mockGithubService.delegateToCodexCloud.mockResolvedValue({
      taskId: 'task_123',
      attemptId: 'attempt_cloud',
      target: 'issue',
      url: 'https://github.com/owner/repo/issues/42',
      number: 42,
      repo: 'owner/repo',
      prompt: '@codex Please work on this task.',
    });

    const response = await request(app).post('/api/github/codex/delegate').send({
      taskId: 'task_123',
      target: 'issue',
      model: 'gpt-5.5',
    });

    expect(response.status).toBe(201);
    expect(response.body.url).toBe('https://github.com/owner/repo/issues/42');
    expect(mockGithubService.delegateToCodexCloud).toHaveBeenCalledWith({
      taskId: 'task_123',
      target: 'issue',
      model: 'gpt-5.5',
    });
  });

  it('rejects invalid Codex Cloud targets', async () => {
    const response = await request(app).post('/api/github/codex/delegate').send({
      taskId: 'task_123',
      target: 'discussion',
    });

    expect(response.status).toBe(400);
    expect(mockGithubService.delegateToCodexCloud).not.toHaveBeenCalled();
  });
});
