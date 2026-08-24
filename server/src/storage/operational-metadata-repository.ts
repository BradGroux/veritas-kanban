import { constants } from 'node:fs';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';

export interface ExecutablePathProbe {
  directPath: boolean;
  found: boolean;
  path?: string;
}

export class OperationalMetadataRepository {
  async probeExecutablePath(command: string): Promise<ExecutablePathProbe> {
    if (!command.includes(path.sep)) return { directPath: false, found: false };

    try {
      await access(command, constants.X_OK);
      return { directPath: true, found: true, path: command };
    } catch {
      return { directPath: true, found: false };
    }
  }

  basename(filePath: string): string {
    return path.basename(filePath);
  }

  async readPackageVersion(packageUrl: URL): Promise<string | undefined> {
    const metadata = JSON.parse(await readFile(packageUrl, 'utf8')) as { version?: unknown };
    return typeof metadata.version === 'string' ? metadata.version : undefined;
  }

  async readSprintLabels(runtimeDir: string): Promise<Map<string, string>> {
    const content = await readFile(path.join(runtimeDir, 'sprints.json'), 'utf8');
    const sprints = JSON.parse(content) as Array<{ id: string; label: string }>;
    return new Map(sprints.map((sprint) => [sprint.id, sprint.label]));
  }
}

export const operationalMetadataRepository = new OperationalMetadataRepository();
