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
  legacyDir: string | readonly string[],
  currentDir: string,
  fileNames: string[],
  serviceName: string
): Promise<void> {
  const legacyDirs = Array.isArray(legacyDir) ? legacyDir : [legacyDir];

  for (const fileName of fileNames) {
    const to = path.join(currentDir, fileName);

    try {
      await fs.access(to);
      continue; // destination exists, skip
    } catch {
      // destination missing; proceed
    }

    for (const candidate of legacyDirs) {
      if (candidate === currentDir) continue;
      const from = path.join(candidate, fileName);

      try {
        const sourceStats = await fs.lstat(from);
        if (!sourceStats.isFile() || sourceStats.isSymbolicLink()) continue;
      } catch {
        continue;
      }

      try {
        await fs.mkdir(path.dirname(to), { recursive: true });
        await fs.copyFile(from, to, fs.constants.COPYFILE_EXCL);
        log.info({ from, to }, `Migrated ${serviceName} data to runtime directory`);
        break;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'EEXIST') break;
        log.warn({ err, from }, `Failed to migrate ${serviceName} data`);
      }
    }
  }
}
