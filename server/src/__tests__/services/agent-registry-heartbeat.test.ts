/**
 * Regression tests for issue #783:
 * Heartbeat updates must not perform synchronous filesystem I/O.
 * Writes are coalesced via a debounce timer and flushed on dispose().
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const writeFileMock = vi.fn().mockResolvedValue(undefined);
const renameMock = vi.fn().mockResolvedValue(undefined);

vi.mock('../../storage/fs-helpers.js', () => ({
  existsSync: vi.fn().mockReturnValue(false),
  readFileSync: vi.fn().mockReturnValue('{}'),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  mkdir: vi.fn().mockResolvedValue(undefined),
  writeFile: writeFileMock,
  rename: renameMock,
}));

const { getAgentRegistryService, disposeAgentRegistryService } =
  await import('../../services/agent-registry-service.js');

describe('AgentRegistryService — heartbeat persistence (issue #783)', () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    writeFileMock.mockClear();
    renameMock.mockClear();
    await disposeAgentRegistryService();
  });

  afterEach(async () => {
    await disposeAgentRegistryService();
    vi.useRealTimers();
  });

  it('does not call writeFile synchronously on heartbeat', () => {
    const service = getAgentRegistryService();
    service.register({ id: 'hb-agent', name: 'HB Agent', capabilities: [] });
    writeFileMock.mockClear();

    service.heartbeat('hb-agent', { status: 'busy' });

    // No synchronous write should have happened yet
    expect(writeFileMock).not.toHaveBeenCalled();
  });

  it('coalesces multiple heartbeats into a single write', async () => {
    const service = getAgentRegistryService();
    service.register({ id: 'hb-agent2', name: 'HB Agent 2', capabilities: [] });
    writeFileMock.mockClear();
    renameMock.mockClear();

    // Fire many heartbeats before the debounce window expires
    for (let i = 0; i < 10; i++) {
      service.heartbeat('hb-agent2', { status: 'busy' });
    }

    expect(writeFileMock).not.toHaveBeenCalled();

    // Advance past the debounce window only (2s), not all timers (would infinite-loop on staleCheck interval)
    await vi.advanceTimersByTimeAsync(3_000);

    // All 10 heartbeats should have produced exactly one write+rename cycle
    expect(writeFileMock).toHaveBeenCalledTimes(1);
    expect(renameMock).toHaveBeenCalledTimes(1);
  });

  it('flushPersist() triggers an immediate write', async () => {
    const service = getAgentRegistryService();
    service.register({ id: 'hb-agent3', name: 'HB Agent 3', capabilities: [] });
    writeFileMock.mockClear();
    renameMock.mockClear();

    service.heartbeat('hb-agent3', { status: 'online' });

    // Flush without waiting for the debounce timer
    await service.flushPersist();

    expect(writeFileMock).toHaveBeenCalledTimes(1);
    expect(renameMock).toHaveBeenCalledTimes(1);
  });

  it('dispose() flushes pending writes before returning', async () => {
    const service = getAgentRegistryService();
    service.register({ id: 'hb-agent4', name: 'HB Agent 4', capabilities: [] });
    writeFileMock.mockClear();
    renameMock.mockClear();

    service.heartbeat('hb-agent4', { status: 'idle' });

    await service.dispose();

    expect(writeFileMock).toHaveBeenCalledTimes(1);
    expect(renameMock).toHaveBeenCalledTimes(1);
  });
});
