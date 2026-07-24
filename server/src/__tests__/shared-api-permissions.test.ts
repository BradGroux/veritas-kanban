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

  it('keeps launch-manifest preview read-scoped', () => {
    expect(
      getApiPermissionRequirement('/api/agents/task_1/launch-preview', { method: 'POST' })
        .permissions
    ).toEqual(['agent:read']);
  });

  it('separates conversation steering from lifecycle mutation authority', () => {
    expect(
      getApiPermissionRequirement('/api/agents/task_1/conversation/steer', {
        method: 'POST',
      }).permissions
    ).toEqual(['task:write']);
    for (const action of [
      'resume',
      'follow-up',
      'fork',
      'interrupt',
      'compact',
      'archive',
      'close',
    ]) {
      expect(
        getApiPermissionRequirement(`/api/v1/agents/task_1/conversation/${action}`, {
          method: 'POST',
        }).permissions
      ).toEqual(['agent:write']);
    }
  });

  it('requires workflow execution for Codex review diff posts', () => {
    expect(
      getApiPermissionRequirement('/api/diff/task_1/codex-review', { method: 'POST' }).permissions
    ).toEqual(['workflow:execute']);
  });

  it('keeps ceremony API under workflow read and write permissions', () => {
    expect(getApiPermissionRequirement('/api/ceremonies').permissions).toEqual(['workflow:read']);
    expect(
      getApiPermissionRequirement('/api/ceremonies/ceremony_1/complete', { method: 'POST' })
        .permissions
    ).toEqual(['workflow:write']);
  });

  it('keeps reflection API under workflow read and write permissions', () => {
    expect(getApiPermissionRequirement('/api/reflections').permissions).toEqual(['workflow:read']);
    expect(
      getApiPermissionRequirement('/api/reflections/reflection_1/accept', { method: 'POST' })
        .permissions
    ).toEqual(['workflow:write']);
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

  it('separates sandbox policy validation from preset mutations', () => {
    expect(
      getApiPermissionRequirement('/api/sandbox-policies/validate', { method: 'POST' }).permissions
    ).toEqual(['policy:read', 'agent:read']);
    expect(
      getApiPermissionRequirement('/api/sandbox-policies', { method: 'POST' }).permissions
    ).toEqual(['policy:write']);
  });

  it('keeps credential broker definitions admin-scoped', () => {
    expect(getApiPermissionRequirement('/api/credential-broker').permissions).toEqual([
      'admin:manage',
    ]);
    expect(
      getApiPermissionRequirement('/api/v1/credential-broker/github-token', {
        method: 'PUT',
      }).permissions
    ).toEqual(['admin:manage']);
  });

  it('separates tool-server administration from run-scoped reads and calls', () => {
    expect(getApiPermissionRequirement('/api/tool-servers').permissions).toEqual(['settings:read']);
    expect(
      getApiPermissionRequirement('/api/tool-servers/fixture', { method: 'PUT' }).permissions
    ).toEqual(['admin:manage']);
    expect(
      getApiPermissionRequirement('/api/v1/tool-servers/runs/task_1/attempt_1/catalog').permissions
    ).toEqual(['agent:read']);
    expect(
      getApiPermissionRequirement('/api/tool-servers/call', { method: 'POST' }).permissions
    ).toEqual(['agent:write']);
  });
});
