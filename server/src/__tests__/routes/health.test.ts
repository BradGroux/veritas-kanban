/**
 * Health Check Route Tests
 *
 * Tests the three-tier health check system:
 *   /health/live  — Liveness probe
 *   /health/ready — Readiness probe
 *   /health/deep  — Full diagnostics (admin only)
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { healthRouter } from '../../routes/health.js';
import { errorHandler } from '../../middleware/error-handler.js';
import {
  resetSqliteStorageDiagnosticsForTests,
  SqliteDatabase,
} from '../../storage/sqlite/database.js';
import {
  createSqliteJournalPolicy,
  revokeSqliteJournalPolicy,
  writeSqliteJournalPolicy,
} from '../../storage/sqlite/sqlite-journal-policy.js';

describe('Health Routes', () => {
  let app: express.Express;
  let testDataDir: string;
  let originalDataDir: string | undefined;
  let originalSqlitePath: string | undefined;
  let originalStorage: string | undefined;
  let originalHostId: string | undefined;
  let originalTopology: string | undefined;
  let originalAdminKey: string | undefined;

  beforeEach(async () => {
    // Create a temp data directory for testing
    const uniqueSuffix = Math.random().toString(36).substring(7);
    testDataDir = path.join(os.tmpdir(), `veritas-health-test-${uniqueSuffix}`);
    await fs.mkdir(testDataDir, { recursive: true });

    // Write a valid tasks.json
    await fs.writeFile(path.join(testDataDir, 'tasks.json'), JSON.stringify([]));

    // Set DATA_DIR env var
    originalDataDir = process.env.DATA_DIR;
    originalSqlitePath = process.env.VERITAS_SQLITE_PATH;
    originalStorage = process.env.VERITAS_STORAGE;
    originalHostId = process.env.VERITAS_SQLITE_HOST_ID;
    originalTopology = process.env.VERITAS_SQLITE_TOPOLOGY;
    originalAdminKey = process.env.VERITAS_ADMIN_KEY;
    process.env.DATA_DIR = testDataDir;

    // Create test app
    app = express();
    app.use(express.json());
    app.use('/health', healthRouter);
    app.use(errorHandler);
  });

  afterEach(async () => {
    // Restore env
    if (originalDataDir !== undefined) {
      process.env.DATA_DIR = originalDataDir;
    } else {
      delete process.env.DATA_DIR;
    }
    if (originalSqlitePath !== undefined) {
      process.env.VERITAS_SQLITE_PATH = originalSqlitePath;
    } else {
      delete process.env.VERITAS_SQLITE_PATH;
    }
    if (originalStorage !== undefined) process.env.VERITAS_STORAGE = originalStorage;
    else delete process.env.VERITAS_STORAGE;
    if (originalHostId !== undefined) process.env.VERITAS_SQLITE_HOST_ID = originalHostId;
    else delete process.env.VERITAS_SQLITE_HOST_ID;
    if (originalTopology !== undefined) process.env.VERITAS_SQLITE_TOPOLOGY = originalTopology;
    else delete process.env.VERITAS_SQLITE_TOPOLOGY;
    if (originalAdminKey !== undefined) process.env.VERITAS_ADMIN_KEY = originalAdminKey;
    else delete process.env.VERITAS_ADMIN_KEY;
    resetSqliteStorageDiagnosticsForTests();

    // Clean up test directory
    try {
      await fs.rm(testDataDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('GET /health/live', () => {
    it('should return 200 with status ok', async () => {
      const res = await request(app).get('/health/live');

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
      expect(res.body.timestamp).toBeDefined();
      expect(typeof res.body.timestamp).toBe('string');
    });
  });

  describe('GET /health (root alias)', () => {
    it('should return 200 with status ok (backwards compat)', async () => {
      const res = await request(app).get('/health');

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
      expect(res.body.timestamp).toBeDefined();
    });
  });

  describe('GET /health/ready', () => {
    it('should return 200 when healthy', async () => {
      const res = await request(app).get('/health/ready');

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
      expect(res.body.checks).toBeDefined();
      expect(res.body.checks.storage).toBe('ok');
      expect(res.body.checks.memory).toBe('ok');
      expect(res.body.checks.disk).toBe('ok');
      expect(res.body.timestamp).toBeDefined();
    });

    it('should return 503 when data directory is missing', async () => {
      // Point to a non-existent directory
      process.env.DATA_DIR = path.join(os.tmpdir(), 'nonexistent-dir-' + Date.now());

      const res = await request(app).get('/health/ready');

      expect(res.status).toBe(503);
      expect(res.body.status).toBe('degraded');
      expect(res.body.checks.storage).toBe('fail');
    });

    it('should return ok when tasks.json does not exist', async () => {
      // Remove tasks.json — fresh install scenario
      await fs.unlink(path.join(testDataDir, 'tasks.json'));

      const res = await request(app).get('/health/ready');

      expect(res.status).toBe(200);
      expect(res.body.checks.storage).toBe('ok');
    });

    it('should return 503 when tasks.json is corrupt', async () => {
      // Write invalid JSON to tasks.json
      await fs.writeFile(path.join(testDataDir, 'tasks.json'), '{invalid json!!!');

      const res = await request(app).get('/health/ready');

      expect(res.status).toBe(503);
      expect(res.body.status).toBe('degraded');
      expect(res.body.checks.storage).toBe('fail');
    });

    it('fails readiness after an active compatibility policy is revoked', async () => {
      const databasePath = path.join(testDataDir, 'revoked-policy.db');
      process.env.VERITAS_STORAGE = 'sqlite';
      process.env.VERITAS_SQLITE_PATH = databasePath;
      process.env.VERITAS_ADMIN_KEY = 'test-admin-key-for-health-check-testing-32chars';
      process.env.VERITAS_SQLITE_HOST_ID = 'health-test-host';
      process.env.VERITAS_SQLITE_TOPOLOGY = 'single-host';
      const raw = new DatabaseSync(databasePath);
      raw.exec('PRAGMA journal_mode = DELETE; CREATE TABLE items (id INTEGER PRIMARY KEY);');
      raw.close();
      const policy = createSqliteJournalPolicy({
        databasePath,
        mode: 'delete',
        actor: 'health-test',
        reason: 'Health readiness revocation test',
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        operationId: randomUUID(),
        source: 'single-host-compatibility',
      });
      writeSqliteJournalPolicy(databasePath, policy);
      const database = new SqliteDatabase({
        databasePath,
        applyMigrations: false,
        filesystemClassifier: () => ({
          platform: 'darwin',
          filesystemType: 'apfs',
          posture: 'supported-local',
          detectionSource: 'health-test',
          reasonCode: 'supported-local-filesystem',
        }),
      });
      database.open();
      revokeSqliteJournalPolicy({
        databasePath,
        actor: 'health-test',
        reason: 'Revoke readiness policy',
      });

      try {
        const res = await request(app).get('/health/ready');
        expect(res.status).toBe(503);
        expect(res.body.checks.sqlite).toBe('fail');
      } finally {
        database.close();
      }
    }, 15_000);
  });

  describe('GET /health/deep', () => {
    it('should return 401 without authentication', async () => {
      const res = await request(app).get('/health/deep');

      expect(res.status).toBe(401);
    });

    it('should return 200 with diagnostics for admin', async () => {
      // Set up admin key for auth — must set NODE_ENV=development
      // so the auth config cache is refreshed with our test key
      const adminKey = 'test-admin-key-for-health-check-testing-32chars';
      const origAdminKey = process.env.VERITAS_ADMIN_KEY;
      const origAuthEnabled = process.env.VERITAS_AUTH_ENABLED;
      const origNodeEnv = process.env.NODE_ENV;
      process.env.VERITAS_ADMIN_KEY = adminKey;
      process.env.VERITAS_AUTH_ENABLED = 'true';
      process.env.NODE_ENV = 'development';
      const databasePath = path.join(testDataDir, 'health-diagnostics.db');
      process.env.VERITAS_SQLITE_PATH = databasePath;
      const database = new SqliteDatabase({
        databasePath,
        applyMigrations: false,
        filesystemClassifier: () => ({
          platform: 'darwin',
          filesystemType: 'apfs',
          posture: 'supported-local',
          detectionSource: 'health-test',
          reasonCode: 'supported-local-filesystem',
        }),
      });
      database.open();

      try {
        const res = await request(app).get('/health/deep').set('X-API-Key', adminKey);

        expect(res.status).toBe(200);
        expect(res.body.status).toBeDefined();
        expect(res.body.checks).toBeDefined();
        expect(res.body.uptime).toBeTypeOf('number');
        expect(res.body.version).toBeDefined();
        expect(res.body.memory).toBeDefined();
        expect(res.body.memory.heapUsed).toBeTypeOf('number');
        expect(res.body.memory.heapTotal).toBeTypeOf('number');
        expect(res.body.memory.rss).toBeTypeOf('number');
        expect(res.body.memory.external).toBeTypeOf('number');
        expect(res.body.node).toBeDefined();
        expect(res.body.node.version).toBe(process.version);
        expect(res.body.node.platform).toBe(process.platform);
        expect(res.body.dataDirectory).toBeDefined();
        expect(res.body.dataDirectory.path).toBe(testDataDir);
        expect(res.body.dataDirectory.sizeBytes).toBeTypeOf('number');
        expect(res.body.sqlite).toMatchObject({
          databaseLocation: 'configured',
          filesystemType: 'apfs',
          filesystemPosture: 'supported-local',
          journalMode: 'wal',
          detectionSource: 'health-test',
          decisionSource: 'automatic',
        });
        expect(JSON.stringify(res.body.sqlite)).not.toContain(databasePath);
        expect(res.body.timestamp).toBeDefined();
      } finally {
        database.close();
        // Restore
        if (origAdminKey !== undefined) process.env.VERITAS_ADMIN_KEY = origAdminKey;
        else delete process.env.VERITAS_ADMIN_KEY;
        if (origAuthEnabled !== undefined) process.env.VERITAS_AUTH_ENABLED = origAuthEnabled;
        else delete process.env.VERITAS_AUTH_ENABLED;
        if (origNodeEnv !== undefined) process.env.NODE_ENV = origNodeEnv;
        else delete process.env.NODE_ENV;
      }
    });
  });
});
