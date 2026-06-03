/**
 * PreviewService Tests
 * Tests port extraction and server-ready detection logic.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PreviewService } from '../services/preview-service.js';

// Mock dependencies
vi.mock('../services/config-service.js', () => ({
  ConfigService: class MockConfigService {
    getConfig = vi.fn().mockResolvedValue({ repos: [] });
  },
}));

vi.mock('../services/task-service.js', () => ({
  TaskService: class MockTaskService {
    getTask = vi.fn();
    listTasks = vi.fn().mockResolvedValue([]);
  },
}));

describe('PreviewService', () => {
  let service: PreviewService;

  beforeEach(() => {
    service = new PreviewService();
  });

  describe('extractPort (private)', () => {
    const extractPort = (output: string) => {
      return (service as any).extractPort(output);
    };

    it('should extract port from localhost URL', () => {
      expect(extractPort('Server running at http://localhost:3000')).toBe(3000);
    });

    it('should extract port from 127.0.0.1 URL', () => {
      expect(extractPort('Listening on http://127.0.0.1:5173')).toBe(5173);
    });

    it('should extract port from "port XXXX" pattern', () => {
      expect(extractPort('Server started on port 8080')).toBe(8080);
    });

    it('should extract port from "listening on" pattern', () => {
      expect(extractPort('Express is listening on :4000')).toBe(4000);
    });

    it('should extract port from generic http URL', () => {
      expect(extractPort('Available at http://myhost:9090/app')).toBe(9090);
    });

    it('should extract 4-5 digit port numbers', () => {
      expect(extractPort('Something running :3001')).toBe(3001);
    });

    it('should return null when no port found', () => {
      expect(extractPort('No port information here')).toBeNull();
    });

    it('should return null for empty string', () => {
      expect(extractPort('')).toBeNull();
    });
  });

  describe('isServerReady (private)', () => {
    const isReady = (output: string, customPattern?: string) => {
      return (service as any).isServerReady(output, customPattern);
    };

    it('should detect "ready" keyword', () => {
      expect(isReady('Server is ready')).toBe(true);
      expect(isReady('READY to accept connections')).toBe(true);
    });

    it('should detect "started" keyword', () => {
      expect(isReady('Server started successfully')).toBe(true);
    });

    it('should detect "listening" keyword', () => {
      expect(isReady('Listening for connections')).toBe(true);
    });

    it('should detect "compiled" keyword', () => {
      expect(isReady('Compiled successfully')).toBe(true);
    });

    it('should detect localhost URL', () => {
      expect(isReady('http://localhost:3000')).toBe(true);
    });

    it('should detect "server running"', () => {
      expect(isReady('Server running on port 3000')).toBe(true);
    });

    it('should return false for unrecognized output', () => {
      expect(isReady('Installing dependencies...')).toBe(false);
      expect(isReady('Building project')).toBe(false);
    });

    it('should use custom pattern when provided', () => {
      expect(isReady('webpack 5.x.x compiled with warnings', 'webpack.*compiled')).toBe(true);
      expect(isReady('Still loading...', 'webpack.*compiled')).toBe(false);
    });
  });

  describe('getPreviewStatus', () => {
    it('should return null for non-running task', () => {
      const status = service.getPreviewStatus('nonexistent-task');
      expect(status).toBeNull();
    });
  });

  describe('getAllPreviews', () => {
    it('should return empty array when nothing is running', () => {
      const previews = service.getAllPreviews();
      expect(previews).toEqual([]);
    });
  });

  describe('getPreviewOutput', () => {
    it('should return empty array for non-running task', () => {
      const output = service.getPreviewOutput('nonexistent-task');
      expect(output).toEqual([]);
    });

    it('redacts secrets before retaining preview process output', () => {
      const info = {
        taskId: 'task_1',
        repoName: 'repo',
        pid: 123,
        port: 3000,
        url: 'http://localhost:3000',
        status: 'running',
        startedAt: '2026-06-02T00:00:00.000Z',
        output: [],
      };

      (service as any).recordOutput(
        info,
        'dev server started with Authorization: Bearer abcdefghijklmnop and key vk_secret123456789'
      );

      expect(info.output[0]).toContain('Bearer [REDACTED]');
      expect(info.output[0]).toContain('[REDACTED_API_KEY]');
      expect(info.output[0]).not.toContain('abcdefghijklmnop');
      expect(info.output[0]).not.toContain('vk_secret123456789');
    });
  });

  describe('stopPreview', () => {
    it('should not throw for non-running task', async () => {
      await expect(service.stopPreview('nonexistent')).resolves.not.toThrow();
    });
  });
});
