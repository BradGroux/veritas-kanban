import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFile, writeFile } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { parseArgs } from 'node:util';
import { createNativeSession } from './session.mjs';

const { values } = parseArgs({
  options: {
    app: { type: 'string' },
    commit: { type: 'string' },
    version: { type: 'string' },
    output: { type: 'string' },
  },
});
for (const key of ['app', 'commit', 'version', 'output'])
  assert(values[key], `--${key} is required`);
const session = await createNativeSession({
  packagePath: values.app,
  commit: values.commit,
  version: values.version,
});
const report = {
  commit: values.commit,
  version: values.version,
  profile: session.profile,
  status: 'running',
  cycles: [],
};
try {
  // Reuse only this synthetic profile to exercise quit and subsequent relaunch.
  for (let cycle = 0; cycle < 2; cycle += 1) {
    const { app, page } = await session.launch();
    let socket;
    let closing;
    const result = { cycle, httpFailures: [] };
    report.cycles.push(result);
    page.on('response', (response) => {
      if (response.status() >= 500)
        result.httpFailures.push({
          status: response.status(),
          path: new URL(response.url()).pathname,
        });
    });
    try {
      assert.equal(await page.evaluate(async () => (await fetch('/api/tasks')).status), 200);
      // Electron uses its own session partition; browser-context cookies are
      // not authoritative here. Keep this synthetic credential in memory only.
      const cookies = await app.evaluate(
        async ({ BrowserWindow }, origin) =>
          BrowserWindow.getAllWindows()[0].webContents.session.cookies.get({ url: origin }),
        session.origin
      );
      assert(
        cookies.some((cookie) => cookie.name === 'veritas_session'),
        'Missing isolated login'
      );
      const cookie = cookies.map((item) => `${item.name}=${item.value}`).join('; ');
      socket = net.connect(Number(new URL(session.origin).port), '127.0.0.1');
      await once(socket, 'connect');
      const chunks = [];
      socket.on('data', (chunk) => chunks.push(chunk));
      const ended = once(socket, 'end');
      void ended.catch(() => {}); // Awaited below; handle early socket errors too.
      socket.setTimeout(15_000, () => socket.destroy(new Error('Diagnostic request timed out')));
      socket.write(
        `GET /api/tasks HTTP/1.1\r\nHost: ${new URL(session.origin).host}\r\nCookie: ${cookie}\r\nConnection: close\r\n`
      );
      await delay(100);
      const started = Date.now();
      closing = app.close();
      void closing.catch(() => {});
      await delay(100);
      socket.write('\r\n');
      await ended;
      await closing;
      result.elapsedMs = Date.now() - started;
      result.statusLine = Buffer.concat(chunks).toString().split('\r\n')[0];
      assert.match(
        result.statusLine,
        /^HTTP\/1.1 200 /,
        'Connected task request outlived its storage'
      );
      assert.deepEqual(result.httpFailures, []);
    } finally {
      socket?.destroy();
      await (closing ?? app.close());
    }
  }
  const log = await readFile(
    path.join(session.profile, 'profiles/native-ui-conformance/workspaces/local/logs/server.log'),
    'utf8'
  );
  assert(
    !/Forced shutdown|Graceful shutdown failed|Unhandled error/.test(log),
    'Server shutdown logged a failure'
  );
  assert.equal(
    (log.match(/\[desktop\] exited code=0 signal=null/g) ?? []).length,
    2,
    'Both server exits must be clean'
  );
  report.status = 'passed';
} catch (error) {
  report.status = 'failed';
  report.error = error.message;
} finally {
  await writeFile(values.output, `${JSON.stringify(report, null, 2)}\n`);
}
console.log(`Native shutdown ${report.status}: ${values.output}`);
process.exitCode = report.status === 'passed' ? 0 : 1;
