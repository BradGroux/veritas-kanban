import type { Page } from '@playwright/test';
import { DEFAULT_FEATURE_SETTINGS } from '../../shared/dist/index.js';
import { unwrapApiData } from './auth';

/** Read-only fixtures for every Settings child dialog; mutations are blocked by the caller. */
export async function installSettingsPopoutFixtures(page: Page) {
  const fulfillRead = async (path: string, json: unknown) => {
    await page.route(path, (route) =>
      route.request().method() === 'GET' ? route.fulfill({ json }) : route.fallback()
    );
  };
  await fulfillRead('**/api/settings/features', {
    ...DEFAULT_FEATURE_SETTINGS,
    sharedResources: {
      ...DEFAULT_FEATURE_SETTINGS.sharedResources,
      enabled: true,
      allowedTypes: ['skill'],
    },
  });
  await fulfillRead('**/api/tool-policies', [
    { role: 'custom', allowed: ['Read'], denied: [], description: '' },
  ]);
  await page.route('**/api/config', async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    const config = unwrapApiData<Record<string, unknown>>(await (await route.fetch()).json());
    await route.fulfill({
      json: {
        ...config,
        repos: [
          {
            name: 'Fixture repository',
            path: '/tmp/settings-popout-fixture',
            defaultBranch: 'main',
          },
        ],
        agents: [
          ...(config.agents as unknown[]),
          { type: 'fixture', name: 'Fixture Agent', command: 'fixture', args: [], enabled: false },
        ],
      },
    });
  });
  const timestamp = '2026-09-01T00:00:00Z';
  // This POST is a read-only compatibility query, not a launch or Settings mutation.
  await page.route('**/api/agents/hosts/preview', (route) =>
    route.fulfill({
      json: {
        generatedAt: timestamp,
        request: route.request().postDataJSON(),
        previews: [],
        decision: { policy: 'disabled', reason: 'Synthetic preview only', excludedHostIds: [] },
      },
    })
  );
  await fulfillRead('**/api/task-types', [
    {
      id: 'fixture',
      label: 'Fixture Type',
      icon: 'code',
      color: 'gray',
      order: 0,
      created: timestamp,
      updated: timestamp,
    },
  ]);
  await fulfillRead('**/api/task-types/fixture/can-delete', {
    allowed: true,
    referenceCount: 0,
    isDefault: false,
  });
  await fulfillRead('**/api/templates', [
    {
      id: 'fixture',
      name: 'Fixture Template',
      version: 1,
      taskDefaults: {},
      created: timestamp,
      updated: timestamp,
    },
  ]);
  await page.route('**/api/maintenance/summary', async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    const summary = unwrapApiData<Record<string, unknown>>(await (await route.fetch()).json());
    await route.fulfill({
      json: {
        ...summary,
        cleanupPreview: {
          destructiveActionsEnabled: false,
          confirmationRequired: true,
          notes: ['Synthetic preview only.'],
          items: Array.from({ length: 12 }, (_, index) => ({
            id: `fixture-${index}`,
            label: `Archived diagnostic output ${index + 1}`,
            category: 'logs',
            cleanupEligible: true,
            affectedCount: 1,
            estimatedBytes: 64,
            retainedReason: 'Synthetic fixture',
          })),
        },
      },
    });
  });
  await fulfillRead('**/api/skills/security/inventory', {
    generatedAt: timestamp,
    totals: { skills: 1, blocked: 0, warnings: 1, unscanned: 0, exceptions: 0 },
    items: [
      {
        skillId: 'fixture',
        name: 'Fixture skill',
        version: 1,
        sourcePath: 'fixture/SKILL.md',
        tags: [],
        mountedIn: [],
        updatedAt: timestamp,
        lastScannedAt: timestamp,
        scanStatus: 'scanned',
        changedFiles: [],
        severity: 'medium',
        riskScore: 25,
        recommendation: 'caution',
        installDecision: 'warn',
        installReason: 'Synthetic warning',
        declaredCapabilities: [],
        observedCapabilities: [],
        mismatches: [],
        findingCount: 1,
        highOrCriticalFindingCount: 0,
      },
    ],
  });
}
