import { readFileSync } from 'node:fs';
import { dirname, join, parse } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

/** Read the installed package's own version without relying on package exports. */
export function getInstalledPackageVersion(packageName: string): string | undefined {
  try {
    let directory = dirname(require.resolve(packageName));
    const root = parse(directory).root;

    while (directory !== root) {
      try {
        const packageJson = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8')) as {
          name?: unknown;
          version?: unknown;
        };
        if (packageJson.name === packageName && typeof packageJson.version === 'string') {
          return packageJson.version;
        }
      } catch {
        // Continue walking until the package root is found.
      }
      directory = dirname(directory);
    }
  } catch {
    // The package may be optional or unavailable in a source-only environment.
  }
  return undefined;
}
