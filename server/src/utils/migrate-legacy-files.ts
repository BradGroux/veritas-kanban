import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { createLogger } from '../lib/logger.js';

const log = createLogger('legacy-migration');

/**
 * Migrate files from a legacy data directory to the current runtime directory.
 * Only copies if: source exists AND destination does NOT exist.
 * Never deletes source files.
 */
export async function migrateLegacyFiles(
  legacyDir: string,
  currentDir: string,
  fileNames: string[],
  serviceName: string
): Promise<void> {
  if (legacyDir === currentDir) return;

  for (const fileName of fileNames) {
    const from = path.join(legacyDir, fileName);
    const to = path.join(currentDir, fileName);

    try {
      await fs.access(from);
    } catch {
      continue;
    }

    try {
      await fs.access(to);
      continue; // destination exists, skip
    } catch {
      // destination missing; proceed
    }

    try {
      await fs.mkdir(path.dirname(to), { recursive: true });
      const data = await fs.readFile(from, 'utf-8');
      await fs.writeFile(to, data);
      log.info({ from, to }, `Migrated ${serviceName} data to runtime directory`);
    } catch (err) {
      log.warn({ err, from }, `Failed to migrate ${serviceName} data`);
    }
  }
}
