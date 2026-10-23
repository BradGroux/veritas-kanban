import path from 'node:path';
import type { SharedResource } from '@veritas-kanban/shared';
import { InternalError } from '../middleware/error-handler.js';
import { SharedResourceRecordsSchema } from '../schemas/shared-resources-schemas.js';
import { withFileLock } from '../services/file-lock.js';
import { getRuntimeDir } from '../utils/paths.js';
import { atomicWriteFile, readFile } from './fs-helpers.js';
import type { SharedResourceRepository } from './interfaces.js';

export class FileSharedResourceRepository implements SharedResourceRepository {
  constructor(private readonly filePath = path.join(getRuntimeDir(), 'shared-resources.json')) {}

  read(): Promise<SharedResource[]> {
    return this.mutate((resources) => ({ resources, result: resources, changed: false }));
  }

  async mutate<T>(
    change: (resources: SharedResource[]) => {
      resources: SharedResource[];
      result: T;
      changed: boolean;
    }
  ): Promise<T> {
    try {
      return await withFileLock(this.filePath, async () => {
        let data: string | undefined;
        try {
          data = await readFile(this.filePath, 'utf8');
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
            throw new InternalError(
              'Shared resources could not be read. Check storage permissions and retry; saved data was preserved.'
            );
          }
        }

        let resources: SharedResource[] = [];
        if (data !== undefined) {
          try {
            resources = SharedResourceRecordsSchema.parse(JSON.parse(data));
          } catch {
            throw new InternalError(
              'The shared-resources.json file is invalid. Repair the file and retry; its saved content was preserved.'
            );
          }
        }

        const mutation = change(resources);
        if (data === undefined || mutation.changed) {
          try {
            const next = SharedResourceRecordsSchema.parse(mutation.resources);
            await atomicWriteFile(this.filePath, JSON.stringify(next, null, 2));
          } catch {
            throw new InternalError(
              'Shared resources could not be saved. Check storage permissions and retry; previous saved content was preserved.'
            );
          }
        }
        return mutation.result;
      });
    } catch (error) {
      if (error instanceof InternalError) throw error;
      throw new InternalError(
        'Shared resources could not be accessed. Check storage permissions and retry; retained content was not discarded.'
      );
    }
  }
}
