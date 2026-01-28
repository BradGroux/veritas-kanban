/**
 * Coverage tests for smaller route files:
 * - activity.ts
 * - summary.ts
 * - status-history.ts
 * - settings.ts
 * - digest.ts
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';

// ===================== Hoisted Mocks =====================

const {
  mockActivityService,
  mockSummaryTaskService,
  mockSummaryService,
  mockStatusHistoryService,
  mockConfigServiceForSettings,
  mockDigestService,
} = vi.hoisted(() => ({
  mockActivityService: {
    getActivities: vi.fn(),
    clearActivities: vi.fn(),
    logActivity: vi.fn().mockResolvedValue(undefined),
  },
  mockSummaryTaskService: {
    listTasks: vi.fn(),
  },
  mockSummaryService: {
    getOverallSummary: vi.fn(),
    getRecentActivity: vi.fn(),
    generateMemoryMarkdown: vi.fn(),
  },
  mockStatusHistoryService: {
    getHistory: vi.fn(),
    getDailySummary: vi.fn(),
    getWeeklySummary: vi.fn(),
    getHistoryByDateRange: vi.fn(),
    clearHistory: vi.fn(),
    logStatusChange: vi.fn().mockResolvedValue(undefined),
  },
  mockConfigServiceForSettings: {
    getFeatureSettings: vi.fn(),
    updateFeatureSettings: vi.fn(),
  },
  mockDigestService: {
    generateDigest: vi.fn(),
    formatForTeams: vi.fn(),
  },
}));

// ===================== Activity Route =====================

vi.mock('../../services/activity-service.js', () => ({
  activityService: mockActivityService,
}));

// ===================== Summary Route =====================

vi.mock('../../services/summary-service.js', () => ({
  getSummaryService: () => mockSummaryService,
}));

// ===================== Status History Route =====================

vi.mock('../../services/status-history-service.js', () => ({
  statusHistoryService: mockStatusHistoryService,
}));

// ===================== Settings Route =====================

vi.mock('../../services/config-service.js', () => ({
  ConfigService: function () {
    return mockConfigServiceForSettings;
  },
}));

vi.mock('../../services/telemetry-service.js', () => ({
  getTelemetryService: () => ({
    configure: vi.fn(),
    isEnabled: vi.fn().mockReturnValue(true),
    setEnabled: vi.fn(),
    getConfig: vi.fn().mockReturnValue({ enabled: true, retention: 30, traces: false }),
    emit: vi.fn().mockResolvedValue({ id: 'e1' }),
    getEvents: vi.fn().mockResolvedValue([]),
    getTaskEvents: vi.fn().mockResolvedValue([]),
    getBulkTaskEvents: vi.fn().mockResolvedValue(new Map()),
    countEvents: vi.fn().mockResolvedValue(0),
    exportAsCsv: vi.fn().mockResolvedValue('csv-data'),
    exportAsJson: vi.fn().mockResolvedValue('{}'),
  }),
}));

vi.mock('../../services/attachment-service.js', () => ({
  getAttachmentService: () => ({
    setLimits: vi.fn(),
    getLimits: vi
      .fn()
      .mockReturnValue({ maxFileSize: 10000000, maxFilesPerTask: 20, maxTotalSize: 50000000 }),
    saveAttachment: vi.fn(),
    getAttachmentPath: vi.fn(),
    getExtractedText: vi.fn(),
    saveExtractedText: vi.fn(),
    deleteAttachment: vi.fn(),
  }),
}));

// ===================== Digest Route =====================

vi.mock('../../services/digest-service.js', () => ({
  getDigestService: () => mockDigestService,
}));

// Mock task service for multiple routes
vi.mock('../../services/task-service.js', () => ({
  TaskService: function () {
    return mockSummaryTaskService;
  },
  getTaskService: () => mockSummaryTaskService,
}));

// Rate limit mock
vi.mock('../../middleware/rate-limit.js', () => ({
  strictRateLimit: (_req: any, _res: any, next: any) => next(),
}));

import activityRouter from '../../routes/activity.js';
import { summaryRoutes } from '../../routes/summary.js';
import { statusHistoryRoutes } from '../../routes/status-history.js';
import { settingsRoutes } from '../../routes/settings.js';
import digestRouter from '../../routes/digest.js';
import { errorHandler } from '../../middleware/error-handler.js';

describe('Activity Routes', () => {
  let app: express.Express;
  beforeEach(() => {
    vi.clearAllMocks();
    app = express();
    app.use(express.json());
    app.use('/api/activity', activityRouter);
    app.use(errorHandler);
  });

  it('GET / should list activities', async () => {
    mockActivityService.getActivities.mockResolvedValue([{ id: 'a1' }]);
    const res = await request(app).get('/api/activity');
    expect(res.status).toBe(200);
  });

  it('GET / should accept limit param', async () => {
    mockActivityService.getActivities.mockResolvedValue([]);
    const res = await request(app).get('/api/activity?limit=10');
    expect(res.status).toBe(200);
    expect(mockActivityService.getActivities).toHaveBeenCalledWith(10);
  });

  it('DELETE / should clear activities', async () => {
    mockActivityService.clearActivities.mockResolvedValue(undefined);
    const res = await request(app).delete('/api/activity');
    expect(res.status).toBe(204);
  });
});

describe('Summary Routes', () => {
  let app: express.Express;
  beforeEach(() => {
    vi.clearAllMocks();
    app = express();
    app.use(express.json());
    app.use('/api/summary', summaryRoutes);
    app.use(errorHandler);
  });

  it('GET / should return summary', async () => {
    mockSummaryTaskService.listTasks.mockResolvedValue([]);
    mockSummaryService.getOverallSummary.mockReturnValue({ total: 0 });
    const res = await request(app).get('/api/summary');
    expect(res.status).toBe(200);
  });

  it('GET /recent should return recent activity', async () => {
    mockSummaryTaskService.listTasks.mockResolvedValue([]);
    mockSummaryService.getRecentActivity.mockReturnValue([]);
    const res = await request(app).get('/api/summary/recent?hours=48');
    expect(res.status).toBe(200);
  });

  it('GET /memory should return markdown', async () => {
    mockSummaryTaskService.listTasks.mockResolvedValue([]);
    mockSummaryService.generateMemoryMarkdown.mockReturnValue('# Summary');
    const res = await request(app).get('/api/summary/memory');
    expect(res.status).toBe(200);
    expect(res.text).toBe('# Summary');
  });
});

describe('Status History Routes', () => {
  let app: express.Express;
  beforeEach(() => {
    vi.clearAllMocks();
    app = express();
    app.use(express.json());
    app.use('/api/status-history', statusHistoryRoutes);
    app.use(errorHandler);
  });

  it('GET / should return history', async () => {
    mockStatusHistoryService.getHistory.mockResolvedValue({ entries: [], total: 0 });
    const res = await request(app).get('/api/status-history');
    expect(res.status).toBe(200);
  });

  it('GET / should accept limit and offset', async () => {
    mockStatusHistoryService.getHistory.mockResolvedValue({ entries: [], total: 0 });
    const res = await request(app).get('/api/status-history?limit=10&offset=5');
    expect(res.status).toBe(200);
    expect(mockStatusHistoryService.getHistory).toHaveBeenCalledWith(10, 5);
  });

  it('GET /summary/daily should return daily summary', async () => {
    mockStatusHistoryService.getDailySummary.mockResolvedValue({ date: '2025-01-01' });
    const res = await request(app).get('/api/status-history/summary/daily');
    expect(res.status).toBe(200);
  });

  it('GET /summary/daily should accept date param', async () => {
    mockStatusHistoryService.getDailySummary.mockResolvedValue({});
    const res = await request(app).get('/api/status-history/summary/daily?date=2025-01-01');
    expect(res.status).toBe(200);
  });

  it('GET /summary/daily should reject invalid date', async () => {
    const res = await request(app).get('/api/status-history/summary/daily?date=invalid');
    expect(res.status).toBe(400);
  });

  it('GET /summary/weekly should return weekly summary', async () => {
    mockStatusHistoryService.getWeeklySummary.mockResolvedValue([]);
    const res = await request(app).get('/api/status-history/summary/weekly');
    expect(res.status).toBe(200);
  });

  it('GET /range should return history by range', async () => {
    mockStatusHistoryService.getHistoryByDateRange.mockResolvedValue([]);
    const res = await request(app).get(
      '/api/status-history/range?startDate=2025-01-01&endDate=2025-01-31'
    );
    expect(res.status).toBe(200);
  });

  it('GET /range should require startDate and endDate', async () => {
    const res = await request(app).get('/api/status-history/range');
    expect(res.status).toBe(400);
  });

  it('DELETE / should clear history', async () => {
    mockStatusHistoryService.clearHistory.mockResolvedValue(undefined);
    const res = await request(app).delete('/api/status-history');
    expect(res.status).toBe(204);
  });
});

describe('Settings Routes', () => {
  let app: express.Express;
  beforeEach(() => {
    vi.clearAllMocks();
    app = express();
    app.use(express.json());
    app.use('/api/settings', settingsRoutes);
  });

  it('GET /features should return settings', async () => {
    mockConfigServiceForSettings.getFeatureSettings.mockResolvedValue({
      telemetry: { enabled: true },
    });
    const res = await request(app).get('/api/settings/features');
    expect(res.status).toBe(200);
  });

  it('GET /features should handle error', async () => {
    mockConfigServiceForSettings.getFeatureSettings.mockRejectedValue(new Error('fail'));
    const res = await request(app).get('/api/settings/features');
    expect(res.status).toBe(500);
  });

  it('PATCH /features should update settings', async () => {
    const settings = {
      telemetry: { enabled: false, retentionDays: 30, enableTraces: false },
      tasks: {
        attachmentMaxFileSize: 10000000,
        attachmentMaxPerTask: 20,
        attachmentMaxTotalSize: 50000000,
      },
    };
    mockConfigServiceForSettings.updateFeatureSettings.mockResolvedValue(settings);
    const res = await request(app)
      .patch('/api/settings/features')
      .send({ telemetry: { enabled: false } });
    expect(res.status).toBe(200);
  });

  it('PATCH /features should handle error', async () => {
    mockConfigServiceForSettings.updateFeatureSettings.mockRejectedValue(new Error('fail'));
    const res = await request(app)
      .patch('/api/settings/features')
      .send({ telemetry: { enabled: false } });
    expect(res.status).toBe(500);
  });
});

describe('Digest Routes', () => {
  let app: express.Express;
  beforeEach(() => {
    vi.clearAllMocks();
    app = express();
    app.use(express.json());
    app.use('/api/digest', digestRouter);
    app.use(errorHandler);
  });

  it('GET /daily should return JSON digest', async () => {
    mockDigestService.generateDigest.mockResolvedValue({ tasks: [] });
    const res = await request(app).get('/api/digest/daily');
    expect(res.status).toBe(200);
  });

  it('GET /daily?format=teams should return Teams format', async () => {
    mockDigestService.generateDigest.mockResolvedValue({ tasks: [] });
    mockDigestService.formatForTeams.mockReturnValue({ isEmpty: false, markdown: '# Digest' });
    const res = await request(app).get('/api/digest/daily?format=teams');
    expect(res.status).toBe(200);
    expect(res.body.markdown).toBe('# Digest');
  });

  it('GET /daily?format=teams should handle empty digest', async () => {
    mockDigestService.generateDigest.mockResolvedValue({ tasks: [] });
    mockDigestService.formatForTeams.mockReturnValue({ isEmpty: true, markdown: '' });
    const res = await request(app).get('/api/digest/daily?format=teams');
    expect(res.status).toBe(200);
    expect(res.body.isEmpty).toBe(true);
  });

  it('GET /daily/preview should return markdown preview', async () => {
    mockDigestService.generateDigest.mockResolvedValue({ tasks: [] });
    mockDigestService.formatForTeams.mockReturnValue({ isEmpty: false, markdown: '# Preview' });
    const res = await request(app).get('/api/digest/daily/preview');
    expect(res.status).toBe(200);
    expect(res.text).toBe('# Preview');
  });

  it('GET /daily/preview should handle empty digest', async () => {
    mockDigestService.generateDigest.mockResolvedValue({ tasks: [] });
    mockDigestService.formatForTeams.mockReturnValue({ isEmpty: true, markdown: '' });
    const res = await request(app).get('/api/digest/daily/preview');
    expect(res.status).toBe(200);
    expect(res.text).toContain('No activity');
  });
});
