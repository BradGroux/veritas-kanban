import { describe, expect, it } from 'vitest';

import { getApiPermissionRequirement } from '../../../shared/src/utils/api-permissions.js';

describe('shared API permission metadata', () => {
  it('requires agent write permission for local agent start and stop routes', () => {
    expect(
      getApiPermissionRequirement('/api/agents/task_1/start', { method: 'POST' }).permissions
    ).toEqual(['agent:write']);
    expect(
      getApiPermissionRequirement('/api/v1/agents/task_1/stop', { method: 'POST' }).permissions
    ).toEqual(['agent:write']);
  });

  it('requires workflow execution for Codex review diff posts', () => {
    expect(
      getApiPermissionRequirement('/api/diff/task_1/codex-review', { method: 'POST' }).permissions
    ).toEqual(['workflow:execute']);
  });

  it('keeps diff reads task-read scoped', () => {
    expect(getApiPermissionRequirement('/api/diff/task_1/full').permissions).toEqual(['task:read']);
  });

  it('normalizes v1 diff paths before checking permissions', () => {
    expect(
      getApiPermissionRequirement('/api/v1/diff/task_1/codex-review', { method: 'POST' })
        .permissions
    ).toEqual(['workflow:execute']);
  });
});
