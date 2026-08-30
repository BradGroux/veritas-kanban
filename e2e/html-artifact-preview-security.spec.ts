import { expect, test } from '@playwright/test';
import { WorkProductArtifactPreviewService } from '../server/src/services/work-product-artifact-preview-service.js';
import type { WorkProductArtifactMetadata } from '@veritas-kanban/shared';

test('HTML artifact preview stays passive in an opaque no-network frame', async ({ page }) => {
  const hostileUrl = 'https://attacker.invalid/preview-pixel';
  const requests: string[] = [];
  page.on('request', (request) => {
    if (request.url().startsWith('https://attacker.invalid/')) requests.push(request.url());
  });
  await page.route('https://attacker.invalid/**', (route) => route.abort());

  const service = new WorkProductArtifactPreviewService({
    artifacts: {
      readPreviewSource: async () => ({
        metadata: artifactMetadata(),
        productStatus: 'active',
        content: Buffer.from(`
          <h1>Isolated report</h1>
          <script>parent.document.body.dataset.compromised = 'true'</script>
          <img src="${hostileUrl}" onerror="alert(document.cookie)">
          <form action="https://attacker.invalid/submit"><button>Submit</button></form>
          <iframe src="https://attacker.invalid/nested"></iframe>
          <a href="https://attacker.invalid/navigate" target="_top" download>Escape</a>
        `),
      }),
    },
  });
  const preview = await service.preview({
    workspaceId: 'local',
    productId: 'wp_html_preview',
    version: 1,
  });
  if (preview.content?.kind !== 'html') throw new Error('Expected HTML preview contract.');

  await page.setContent(
    '<main data-compromised="false"><iframe title="HTML preview"></iframe></main>'
  );
  const frameElement = page.getByTitle('HTML preview');
  await frameElement.evaluate(
    (element, input) => {
      const frame = element as HTMLIFrameElement;
      frame.setAttribute('sandbox', input.sandbox);
      frame.setAttribute('referrerpolicy', 'no-referrer');
      frame.srcdoc = input.document;
    },
    {
      document: preview.content.document,
      sandbox: preview.content.sandbox,
    }
  );
  const frame = page.frames().find((candidate) => candidate !== page.mainFrame());
  if (!frame) throw new Error('Preview frame did not load.');
  await expect(frame.getByRole('heading', { name: 'Isolated report' })).toBeVisible();

  expect(await frame.evaluate(() => location.origin)).toBe('null');
  expect(
    await frame.evaluate(() => {
      try {
        localStorage.setItem('preview', 'forbidden');
        return 'allowed';
      } catch (error) {
        return error instanceof DOMException ? error.name : 'blocked';
      }
    })
  ).toBe('SecurityError');
  expect(await frame.locator('script, img, form, iframe, a').count()).toBe(0);
  expect(
    await frame.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content')
  ).toBe(preview.content.contentSecurityPolicy);
  expect(await frameElement.getAttribute('sandbox')).toBe('');
  expect(await frameElement.getAttribute('referrerpolicy')).toBe('no-referrer');
  expect(await page.locator('main').getAttribute('data-compromised')).toBe('false');
  expect(requests).toEqual([]);
});

function artifactMetadata(): WorkProductArtifactMetadata {
  return {
    schemaVersion: 'work-product-artifact/v1',
    id: 'wpa_html_preview',
    productId: 'wp_html_preview',
    version: 1,
    workspaceId: 'local',
    taskId: 'task_html_preview',
    runId: 'run_html_preview',
    attemptId: 'attempt_html_preview',
    producingEventId: 'runevt_html_preview',
    requestIdDigest: `sha256:${'a'.repeat(64)}`,
    launchManifestDigest: `sha256:${'b'.repeat(64)}`,
    mediaType: 'text/html',
    byteSize: 1,
    sha256: 'c'.repeat(64),
    safeName: 'report.html',
    state: 'available',
    redaction: { state: 'none' },
    createdAt: '2026-08-30T00:00:00.000Z',
  };
}
