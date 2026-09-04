// Deterministic read-only API data; the packaged renderer, preload and window stay real.
// Text preview coverage does not certify PDF rendering (tracked separately in #1448).
export async function installPreviewFixture(page, taskId) {
  const createdAt = '2026-09-01T09:00:00Z';
  const artifact = {
    schemaVersion: 'work-product-artifact/v1',
    id: 'wpa_native_ui',
    productId: 'wp_native_ui',
    version: 1,
    workspaceId: 'local',
    taskId,
    runId: 'run_native_ui',
    attemptId: 'attempt_native_ui',
    producingEventId: 'event_native_ui',
    requestIdDigest: `sha256:${'a'.repeat(64)}`,
    launchManifestDigest: `sha256:${'b'.repeat(64)}`,
    mediaType: 'text/plain',
    byteSize: 2100,
    sha256: 'c'.repeat(64),
    safeName: 'acceptance.txt',
    state: 'available',
    redaction: { state: 'none' },
    createdAt,
  };
  const product = {
    id: artifact.productId,
    workspaceId: 'local',
    kind: 'file',
    title: 'Native acceptance artifact',
    status: 'active',
    version: 1,
    taskId,
    sourceRunId: artifact.runId,
    sourceLinks: [],
    redacted: true,
    snippet: 'Public-safe fixture',
    createdAt,
    updatedAt: createdAt,
    artifact,
  };
  const listPattern = `**/api/tasks/${taskId}/work-products?*`;
  const previewPattern = `**/api/work-products/${product.id}/artifact/preview**`;
  const auditPattern = `**/api/work-products/${product.id}/artifact/preview/audit**`;
  await page.route(listPattern, (route) => route.fulfill({ json: [product] }));
  await page.route(previewPattern, (route) =>
    route.fulfill({
      json: {
        schemaVersion: 'work-product-artifact-preview/v1',
        status: 'ready',
        renderer: 'text',
        message: 'Preview ready.',
        artifact,
        sourceRunId: artifact.runId,
        redactionState: 'none',
        causalEvent: {
          taskId,
          runId: artifact.runId,
          attemptId: artifact.attemptId,
          eventId: artifact.producingEventId,
        },
        limits: { maxBytes: 8192, maxPages: 100 },
        truncation: { truncated: false, reasons: [] },
        actions: { downloadAllowed: true, openAssociatedAppAllowed: false },
        content: { kind: 'text', text: 'Native text evidence\n'.repeat(100) },
      },
    })
  );
  await page.route(auditPattern, (route) => route.fulfill({ json: {} }));
  return async () => {
    for (const pattern of [listPattern, previewPattern, auditPattern]) await page.unroute(pattern);
  };
}
