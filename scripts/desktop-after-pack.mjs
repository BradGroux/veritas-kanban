import { cp, rm, stat } from 'node:fs/promises';
import path from 'node:path';

async function assertDirectory(label, targetPath) {
  const stats = await stat(targetPath);
  if (!stats.isDirectory()) {
    throw new Error(`${label} is not a directory: ${targetPath}`);
  }
}

export default async function desktopAfterPack(context) {
  if (context.electronPlatformName !== 'darwin') {
    return;
  }

  const desktopDir = context.packager.projectDir;
  const stagingDir = path.join(desktopDir, '.desktop-release');
  const resourcesDir = path.join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.app`,
    'Contents',
    'Resources'
  );

  const stagedServer = path.join(stagingDir, 'server');
  const stagedWeb = path.join(stagingDir, 'web');
  const packagedServer = path.join(resourcesDir, 'server');
  const packagedWeb = path.join(resourcesDir, 'web');

  await Promise.all([
    assertDirectory('Desktop server staging', stagedServer),
    assertDirectory('Desktop web staging', stagedWeb),
    assertDirectory('Packaged resources', resourcesDir),
  ]);

  await Promise.all([
    rm(packagedServer, { recursive: true, force: true }),
    rm(packagedWeb, { recursive: true, force: true }),
  ]);

  await Promise.all([
    cp(stagedServer, packagedServer, {
      recursive: true,
      force: true,
      verbatimSymlinks: true,
    }),
    cp(stagedWeb, packagedWeb, {
      recursive: true,
      force: true,
      verbatimSymlinks: true,
    }),
  ]);
}
