import { performance } from 'node:perf_hooks';
import { createTestSqliteDatabase } from '../src/storage/sqlite/test-helpers.js';
import { SqliteNotificationRepository } from '../src/storage/sqlite/notification-repository.js';
import { NotificationService } from '../src/services/notification-service.js';
const entries = [];
for (const count of [100, 1000, 10000]) {
  const fixture = createTestSqliteDatabase();
  fixture.database.open();
  const repo = new SqliteNotificationRepository(fixture.database);
  const rows = Array.from({ length: count }, (_, i) => ({
    id: `benchmark-${String(i).padStart(5, '0')}`,
    taskId: 'benchmark',
    targetAgent: 'test',
    fromAgent: 'fixture',
    content: 'Public-safe benchmark notification',
    type: 'mention',
    delivered: false,
    createdAt: new Date(1700000000000 + i).toISOString(),
  }));
  repo.saveNotifications(rows);
  const service = new NotificationService({
    storageType: 'sqlite',
    sqliteDatabase: fixture.database,
    dataDir: fixture.rootDir,
  });
  const db = fixture.database.getConnection();
  const changes = () => Number(db.prepare('SELECT total_changes() AS n').get()?.n);
  const before = changes();
  const coldStart = performance.now();
  await service.markDelivered(rows[0].id);
  const coldMs = performance.now() - coldStart;
  const coldChangedRows = changes() - before;
  const durations = [];
  const touched = [];
  for (let i = 1; i <= 25; i++) {
    const startChanges = changes();
    const start = performance.now();
    await service.markDelivered(rows[i].id);
    durations.push(performance.now() - start);
    touched.push(changes() - startChanges);
  }
  durations.sort((a, b) => a - b);
  entries.push({
    count,
    coldMs,
    coldChangedRows,
    warmMedianMs: durations[12],
    warmP95Ms: durations[23],
    changedRowsPerWrite: [...new Set(touched)],
  });
  service.dispose();
  fixture.cleanup();
}
console.log(
  JSON.stringify(
    {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      operation: 'NotificationService.markDelivered',
      warmSamples: 25,
      entries,
    },
    null,
    2
  )
);
