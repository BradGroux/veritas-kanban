import { describe, expect, it, vi } from 'vitest';

const order = vi.hoisted(() => [] as string[]);

vi.mock('../config/env.js', () => ({
  validateEnv() {
    order.push('validate-env');
  },
}));

vi.mock('../storage/sqlite/journal-maintenance-service.js', () => ({
  async executeScheduledSqliteJournalMaintenance() {
    order.push('sqlite-maintenance');
  },
}));

vi.mock('../server.js', () => {
  order.push('server-import');
  return {};
});

describe('server bootstrap ordering', () => {
  it('executes scheduled SQLite maintenance before importing the application server', async () => {
    await import('../index.js');
    expect(order).toEqual(['validate-env', 'sqlite-maintenance', 'server-import']);
  });
});
