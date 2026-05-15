import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function read(relativePath: string): string {
  return fs.readFileSync(path.join(serverRoot, relativePath), 'utf8');
}

describe('blocked task alerts', () => {
  it('fires an alert when TaskService transitions a task into blocked', () => {
    const source = read('services/task-service.ts');

    expect(source).toContain("import { alertTaskBlocked } from './blocked-alert-service.js';");
    expect(source).toContain("updatedTask.status === 'blocked' && previousStatus !== 'blocked'");
    expect(source).toContain('alertTaskBlocked(updatedTask, previousStatus)');
  });

  it('persists Veritas notifications and sends Telegram without exposing secrets', () => {
    const source = read('services/blocked-alert-service.ts');

    expect(source).toContain("new Set<string>(['hawk'])");
    expect(source).toContain('notifyStatusChange');
    expect(source).toContain('https://api.telegram.org/bot${token}/sendMessage');
    expect(source).toContain('DISCORD_BLOCKED_ALERT_WEBHOOK_URL');
    expect(source).toContain('DISCORD_WEBHOOK_URL');
    expect(source).toContain('allowed_mentions');
    expect(source).toContain('TELEGRAM_BOT_TOKEN_HAWK');
    expect(source).toContain('/Users/admin/.hermes/profiles/hawk/.env');
    expect(source).not.toMatch(/console\.log\([^)]*token/i);
  });

  it('stores notifications under the live Veritas data root when configured', () => {
    const source = read('services/notification-service.ts');

    expect(source).toContain('process.env.VERITAS_DATA_DIR');
    expect(source).toContain('async notifyStatusChange');
    expect(source).toContain("type: 'status_change'");
  });
});
