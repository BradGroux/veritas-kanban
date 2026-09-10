import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Task, TaskAttempt } from '@veritas-kanban/shared';
import {
  OpenClawCompletionService,
  assertOpenClawRunBinding,
  normalizeOpenClawTerminal,
  openClawCompletionProbeSource,
  type OpenClawRunBinding,
} from '../services/openclaw-completion-service.js';
import type { HttpOpenClawTaskAdapter } from '../services/openclaw-workflow-adapter.js';

const binding: OpenClawRunBinding = {
  schemaVersion: 'openclaw-task-run/v1',
  gatewayUrl: 'http://127.0.0.1:18789',
  gatewayVersion: '2026.9.2',
  runId: 'run-1',
  sessionKey: 'child-1',
  workspaceId: 'workspace-1',
  taskId: 'task-1',
  attemptId: 'attempt-1',
  providerRuntimeManifestDigest: 'runtime-digest',
  taskEnvelopeDigest: 'envelope-digest',
  runLaunchManifestDigest: 'launch-digest',
  observeUntil: '2026-09-10T04:30:00Z',
};
function task(): Task & { attempt: TaskAttempt & { openclawRun: OpenClawRunBinding } } {
  return {
    id: binding.taskId,
    attempt: {
      id: binding.attemptId,
      status: 'running',
      provider: 'openclaw',
      sessionKey: binding.sessionKey,
      openclawRun: { ...binding },
      providerRuntimeManifest: {
        digest: binding.providerRuntimeManifestDigest,
        providerVersion: binding.gatewayVersion,
        probe: { source: openClawCompletionProbeSource(binding.gatewayUrl) },
      },
      taskEnvelope: {
        digest: binding.taskEnvelopeDigest,
        workspace: { workspaceId: binding.workspaceId },
      },
      runLaunchManifest: { digest: binding.runLaunchManifestDigest },
    },
  } as Task & { attempt: TaskAttempt & { openclawRun: OpenClawRunBinding } };
}
function terminal(status = 'success') {
  return {
    version: '2026.9.2',
    result: {
      runId: 'run-1',
      status: 'ok' as const,
      endedAt: 100,
      terminalReply: {
        disposition: 'visible',
        text: JSON.stringify({
          schemaVersion: 'veritas-openclaw-completion/v1',
          status,
          summary: 'Verified result',
        }),
      },
    },
  };
}
function fixture(response = terminal()) {
  const current = task();
  const host = {
    getTask: vi.fn(async () => current),
    complete: vi.fn(async () => {}),
    requireRecovery: vi.fn(async () => {}),
  };
  const adapter = { assertGatewayBinding: vi.fn(), waitForRun: vi.fn(async () => response) };
  const service = new OpenClawCompletionService(
    host,
    () => adapter as unknown as HttpOpenClawTaskAdapter,
    () => Date.parse('2026-09-10T04:00:00Z')
  );
  return { service, host, adapter, current };
}
afterEach(() => vi.restoreAllMocks());

describe('OpenClaw terminal normalization', () => {
  it.each(['success', 'failed', 'blocked'])(
    'preserves an explicit %s report from the terminal reply',
    (status) => {
      expect(normalizeOpenClawTerminal(terminal(status).result)).toMatchObject({
        status,
        terminalSource: 'remote-session',
        summary: 'Verified result',
      });
    }
  );
  it('does not treat gateway wait timeout or pending queue state as completion', () => {
    expect(normalizeOpenClawTerminal({ runId: 'run-1', status: 'timeout' })).toBeNull();
    expect(normalizeOpenClawTerminal({ runId: 'run-1', status: 'pending' })).toBeNull();
  });
  it('preserves a runtime failure even if reply text claims success', () => {
    expect(
      normalizeOpenClawTerminal({ ...terminal().result, status: 'error', error: 'Provider failed' })
    ).toMatchObject({ status: 'failed', error: 'Provider failed' });
  });
  it.each([
    undefined,
    { disposition: 'visible', text: 'Done!' },
    { disposition: 'hidden', text: terminal().result.terminalReply.text },
  ])('blocks unverifiable or non-visible final output', (terminalReply) => {
    expect(normalizeOpenClawTerminal({ ...terminal().result, terminalReply })).toMatchObject({
      status: 'blocked',
    });
  });
});

describe('OpenClaw completion ownership', () => {
  it.each([
    ['workspaceId', 'other'],
    ['taskId', 'other'],
    ['attemptId', 'other'],
    ['sessionKey', 'other'],
    ['runId', 'other'],
    ['providerRuntimeManifestDigest', 'other'],
    ['taskEnvelopeDigest', 'other'],
    ['runLaunchManifestDigest', 'other'],
    ['gatewayUrl', 'https://other.invalid'],
    ['gatewayVersion', 'other'],
    ['observeUntil', 'invalid'],
  ])('rejects a mismatched %s', (field, value) => {
    expect(() => assertOpenClawRunBinding(task(), { ...binding, [field]: value })).toThrow(
      /does not match/
    );
  });
  it('rejects another provider even with the same identifiers', () => {
    const current = task();
    current.attempt.provider = 'codex-cli';
    expect(() => assertOpenClawRunBinding(current, binding)).toThrow();
  });
  it('completes once through the attempt authority despite duplicate monitor starts', async () => {
    const { service, host, adapter } = fixture();
    service.start(binding);
    service.start(binding);
    await vi.waitFor(() => expect(host.complete).toHaveBeenCalledTimes(1));
    expect(host.complete).toHaveBeenCalledWith(
      binding,
      expect.objectContaining({ status: 'success', terminalSource: 'remote-session' })
    );
    expect(adapter.waitForRun).toHaveBeenCalledTimes(1);
    expect(host.requireRecovery).not.toHaveBeenCalled();
  });
  it('discards a terminal response after the active attempt changes', async () => {
    const { service, host, adapter, current } = fixture();
    adapter.waitForRun.mockImplementation(async () => {
      current.attempt.id = 'new-attempt';
      return terminal();
    });
    service.start(binding);
    await vi.waitFor(() => expect(adapter.waitForRun).toHaveBeenCalled());
    expect(host.complete).not.toHaveBeenCalled();
  });
  it('requires recovery on gateway failure without inventing a terminal result', async () => {
    const { service, host, adapter } = fixture();
    adapter.waitForRun.mockRejectedValue(new Error('socket gone'));
    service.start(binding);
    await vi.waitFor(() => expect(host.requireRecovery).toHaveBeenCalledTimes(1));
    expect(host.complete).not.toHaveBeenCalled();
  });
  it('requires recovery on a changed gateway build', async () => {
    const { service, host } = fixture({ ...terminal(), version: '2026.9.3' });
    service.start(binding);
    await vi.waitFor(() => expect(host.requireRecovery).toHaveBeenCalledTimes(1));
    expect(host.complete).not.toHaveBeenCalled();
  });
  it('reconstructs observation from persisted identity without spawning another child', async () => {
    const { service, host, adapter } = fixture();
    expect(await service.canRecover(task())).toBe(true);
    service.start(JSON.parse(JSON.stringify(binding)));
    await vi.waitFor(() => expect(host.complete).toHaveBeenCalledOnce());
    expect(adapter.waitForRun).toHaveBeenNthCalledWith(1, 'run-1', 0);
  });
  it('does not recover a mismatched gateway or expired observation', async () => {
    const { service, adapter } = fixture();
    adapter.assertGatewayBinding.mockImplementation(() => {
      throw new Error('changed');
    });
    expect(await service.canRecover(task())).toBe(false);
    expect(adapter.waitForRun).not.toHaveBeenCalled();
    const expired = task();
    expired.attempt.openclawRun.observeUntil = '2026-09-09T00:00:00Z';
    const expiredFixture = fixture();
    expiredFixture.adapter.waitForRun.mockResolvedValue({
      version: '2026.9.2',
      result: { runId: 'run-1', status: 'timeout' },
    } as ReturnType<typeof terminal>);
    expect(await expiredFixture.service.canRecover(expired)).toBe(false);
    expect(await fixture().service.canRecover(expired)).toBe(true);
  });
});
