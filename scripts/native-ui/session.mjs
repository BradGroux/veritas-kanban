/* global window */
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, realpath } from 'node:fs/promises';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { _electron, expect } from '@playwright/test';

// Each session owns a disposable profile and packaged server. Repeated launch()
// calls reuse only that session's synthetic login and state, never the operator's.
export async function createNativeSession({ packagePath, commit, version }) {
  const profile = await mkdtemp(path.join(os.tmpdir(), 'vk-native-conformance-'));
  const port = await new Promise((resolve, reject) => {
    const server = createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
  const origin = `http://127.0.0.1:${port}`;
  const password = randomBytes(24).toString('base64url');
  const env = Object.fromEntries(
    ['PATH', 'HOME', 'TMPDIR', 'LANG', 'USER', 'LOGNAME']
      .filter((key) => process.env[key])
      .map((key) => [key, process.env[key]])
  );
  Object.assign(env, {
    VERITAS_DESKTOP_PROFILE: 'native-ui-conformance',
    VERITAS_DESKTOP_SERVER_PORT: String(port),
  });

  async function authenticateUnsafe(page) {
    const setup = page.getByRole('button', { name: 'Continue to Password', exact: true });
    const settings = page.getByRole('button', { name: /^(?:Settings|Mobile settings)$/ });
    const login = page.getByRole('button', { name: 'Login', exact: true });
    await expect(setup.or(settings).or(login)).toBeVisible({ timeout: 30_000 });
    if (await setup.isVisible()) {
      await setup.click();
      await page.getByLabel('Password', { exact: true }).fill(password);
      await page.getByLabel('Confirm Password', { exact: true }).fill(password);
      await page.getByRole('button', { name: 'Create Password', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Save Your Recovery Key' })).toBeVisible();
      await page.reload(); // Never capture recovery keys or synthetic passwords.
    }
    await expect(login.or(settings)).toBeVisible({ timeout: 30_000 });
    if (await login.isVisible()) {
      await page.getByLabel('Password', { exact: true }).fill(password);
      await login.click();
    }
    await expect(settings).toBeVisible({ timeout: 30_000 });
  }

  async function authenticate(page) {
    try {
      await authenticateUnsafe(page);
    } catch (error) {
      // Playwright can include fill() values in its call log. Never persist the
      // synthetic login credential in native or media diagnostic reports.
      error.message = String(error.message).replaceAll(password, '[redacted]');
      if (error.stack) error.stack = error.stack.replaceAll(password, '[redacted]');
      throw error;
    }
  }

  return {
    origin,
    profile,
    authenticate,
    async launch() {
      const app = await _electron.launch({
        executablePath: path.join(packagePath, 'Contents/MacOS/veritas-kanban'),
        args: [`--user-data-dir=${profile}`],
        env,
      });
      try {
        const actual = await app.evaluate(({ app }) => ({
          packaged: app.isPackaged,
          userData: app.getPath('userData'),
          appPath: app.getAppPath(),
        }));
        assert(actual.packaged, 'Unpackaged runtime is not native acceptance');
        assert.equal(
          await realpath(actual.userData),
          await realpath(profile),
          'Profile isolation failed'
        );
        assert.equal(
          await realpath(actual.appPath),
          await realpath(path.join(packagePath, 'Contents/Resources/app.asar')),
          'Wrong package launched'
        );
        const page = await app.firstWindow();
        page.setDefaultTimeout(10_000);
        await page.waitForURL(`${origin}/**`, { timeout: 60_000 });
        await authenticate(page);
        const identity = await page.evaluate(() => window.veritasDesktop.getAppInfo());
        assert.equal(
          identity.buildIdentity,
          commit,
          'Rebuild the candidate with VERITAS_BUILD_SHA equal to HEAD'
        );
        assert.equal(identity.version, version);
        await app.evaluate(({ app, BrowserWindow }) => {
          app.focus({ steal: true });
          BrowserWindow.getAllWindows()[0].focus();
        });
        return { app, page, identity };
      } catch (error) {
        await app.close();
        throw error;
      }
    },
  };
}
