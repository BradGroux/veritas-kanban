/**
 * Shared test utilities — custom render wrapper, mock factories, and helpers.
 */
import React, { type ReactNode } from 'react';
import { render, type RenderOptions } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WebSocketStatusProvider } from '@/contexts/WebSocketContext';
import { MantineRoot } from '@/theme/MantineRoot';
import type { ConnectionState } from '@/hooks/useWebSocket';
import type {
  Task,
  TaskStatus,
  TaskPriority,
  TaskTypeConfig,
  ProjectConfig,
  SprintConfig,
} from '@veritas-kanban/shared';

// ── Query Client Factory ─────────────────────────────────────

/** Create a fresh QueryClient configured for testing (no retries, no GC). */
export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: Infinity,
      },
      mutations: {
        retry: false,
      },
    },
  });
}

// ── WebSocket Status Defaults ────────────────────────────────

export interface TestWebSocketStatus {
  isConnected: boolean;
  connectionState: ConnectionState;
  reconnectAttempt: number;
}

const DEFAULT_WS_STATUS: TestWebSocketStatus = {
  isConnected: true,
  connectionState: 'connected',
  reconnectAttempt: 0,
};

function createMemoryStorage(): Storage {
  const storage = new Map<string, string>();

  return {
    get length() {
      return storage.size;
    },
    clear: () => storage.clear(),
    getItem: (key: string) => storage.get(key) ?? null,
    key: (index: number) => Array.from(storage.keys())[index] ?? null,
    removeItem: (key: string) => {
      storage.delete(key);
    },
    setItem: (key: string, value: string) => {
      storage.set(key, value);
    },
  };
}

function ensureMantineBrowserApis() {
  if (typeof window === 'undefined') return;

  if (typeof window.matchMedia !== 'function') {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: (query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }),
    });
  }

  if (typeof window.ResizeObserver !== 'function') {
    Object.defineProperty(window, 'ResizeObserver', {
      configurable: true,
      value: class ResizeObserver {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    });
  }

  try {
    window.localStorage.getItem('__veritas_test_probe__');
  } catch {
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: createMemoryStorage(),
    });
  }
}

// ── All Providers Wrapper ────────────────────────────────────

interface AllProvidersProps {
  children: ReactNode;
  queryClient?: QueryClient;
  wsStatus?: Partial<TestWebSocketStatus>;
}

function AllProviders({ children, queryClient, wsStatus }: AllProvidersProps) {
  ensureMantineBrowserApis();
  const qc = queryClient ?? createTestQueryClient();
  const ws = { ...DEFAULT_WS_STATUS, ...wsStatus };
  return (
    <MantineRoot env="test">
      <QueryClientProvider client={qc}>
        <WebSocketStatusProvider
          isConnected={ws.isConnected}
          connectionState={ws.connectionState}
          reconnectAttempt={ws.reconnectAttempt}
        >
          {children}
        </WebSocketStatusProvider>
      </QueryClientProvider>
    </MantineRoot>
  );
}

// ── Custom Render ────────────────────────────────────────────

interface CustomRenderOptions extends Omit<RenderOptions, 'wrapper'> {
  queryClient?: QueryClient;
  wsStatus?: Partial<TestWebSocketStatus>;
}

/**
 * Render with all necessary providers (QueryClient, WebSocket context).
 * Accepts optional overrides for each provider.
 */
export function renderWithProviders(ui: React.ReactElement, options: CustomRenderOptions = {}) {
  const { queryClient, wsStatus, ...renderOptions } = options;
  const qc = queryClient ?? createTestQueryClient();

  return {
    ...render(ui, {
      wrapper: ({ children }: { children: ReactNode }) => (
        <AllProviders queryClient={qc} wsStatus={wsStatus}>
          {children}
        </AllProviders>
      ),
      ...renderOptions,
    }),
    queryClient: qc,
  };
}

// ── Mock Data Factories ──────────────────────────────────────

let taskCounter = 0;

/** Create a mock Task with sensible defaults. Override any field. */
export function createMockTask(overrides: Partial<Task> = {}): Task {
  taskCounter += 1;
  const id = overrides.id ?? `task_${taskCounter}`;
  return {
    id,
    title: `Test Task ${taskCounter}`,
    description: `Description for task ${taskCounter}`,
    type: 'feature',
    status: 'todo' as TaskStatus,
    priority: 'medium' as TaskPriority,
    created: '2025-01-01T00:00:00Z',
    updated: '2025-01-01T00:00:00Z',
    ...overrides,
  };
}

/** Create a batch of mock tasks with sequential defaults. */
export function createMockTasks(count: number, overrides: Partial<Task> = {}): Task[] {
  return Array.from({ length: count }, () => createMockTask(overrides));
}

/** Create a mock TaskTypeConfig. */
export function createMockTaskType(overrides: Partial<TaskTypeConfig> = {}): TaskTypeConfig {
  return {
    id: 'feature',
    label: 'Feature',
    icon: 'Code',
    order: 0,
    created: '2025-01-01T00:00:00Z',
    updated: '2025-01-01T00:00:00Z',
    ...overrides,
  };
}

/** Create a mock ProjectConfig. */
export function createMockProject(overrides: Partial<ProjectConfig> = {}): ProjectConfig {
  return {
    id: 'proj-1',
    label: 'Test Project',
    order: 0,
    created: '2025-01-01T00:00:00Z',
    updated: '2025-01-01T00:00:00Z',
    ...overrides,
  };
}

/** Create a mock SprintConfig. */
export function createMockSprint(overrides: Partial<SprintConfig> = {}): SprintConfig {
  return {
    id: 'sprint-1',
    label: 'Sprint 1',
    order: 0,
    created: '2025-01-01T00:00:00Z',
    updated: '2025-01-01T00:00:00Z',
    ...overrides,
  };
}

// ── Fetch Mock Helper ────────────────────────────────────────

/**
 * Mock global fetch with an envelope response.
 * Returns the mock so you can inspect calls and change return values.
 */
export function mockFetch(data: unknown, ok = true) {
  const response = {
    ok,
    status: ok ? 200 : 500,
    json: async () => ({
      success: ok,
      data,
      meta: { timestamp: new Date().toISOString() },
      ...(ok ? {} : { error: { code: 'TEST_ERROR', message: 'Test error' } }),
    }),
  } as Response;

  const fetchMock = globalThis.fetch as ReturnType<typeof import('vitest').vi.fn> | undefined;
  if (fetchMock && typeof fetchMock.mockResolvedValue === 'function') {
    fetchMock.mockResolvedValue(response);
    return fetchMock;
  }

  const mock = Object.assign(async () => response, {
    mockResolvedValue: () => {},
  }) as unknown as typeof globalThis.fetch;
  globalThis.fetch = mock;
  return mock;
}

/**
 * Create a mock WebSocket class for testing.
 * Does NOT actually open a connection; instead it exposes helpers
 * so tests can manually trigger onopen / onmessage / onclose / onerror.
 */
export function createMockWebSocket() {
  const instances: MockWebSocketInstance[] = [];

  class MockWebSocket {
    static readonly CONNECTING = 0;
    static readonly OPEN = 1;
    static readonly CLOSING = 2;
    static readonly CLOSED = 3;

    readonly CONNECTING = 0;
    readonly OPEN = 1;
    readonly CLOSING = 2;
    readonly CLOSED = 3;

    readyState = MockWebSocket.CONNECTING;
    url: string;
    protocol = '';
    extensions = '';
    bufferedAmount = 0;
    binaryType: BinaryType = 'blob';

    onopen: ((ev: Event) => void) | null = null;
    onmessage: ((ev: MessageEvent) => void) | null = null;
    onclose: ((ev: CloseEvent) => void) | null = null;
    onerror: ((ev: Event) => void) | null = null;

    sent: string[] = [];

    constructor(url: string | URL, _protocols?: string | string[]) {
      this.url = typeof url === 'string' ? url : url.toString();
      instances.push(this as unknown as MockWebSocketInstance);
    }

    send(data: string) {
      this.sent.push(data);
    }

    close(_code?: number, _reason?: string) {
      this.readyState = MockWebSocket.CLOSED;
      this.onclose?.(new CloseEvent('close', { code: _code, reason: _reason }));
    }

    addEventListener() {}
    removeEventListener() {}
    dispatchEvent() {
      return false;
    }

    // Test helpers
    simulateOpen() {
      this.readyState = MockWebSocket.OPEN;
      this.onopen?.(new Event('open'));
    }

    simulateMessage(data: Record<string, unknown>) {
      this.onmessage?.(new MessageEvent('message', { data: JSON.stringify(data) }));
    }

    simulateError() {
      this.onerror?.(new Event('error'));
    }

    simulateClose(code = 1000, reason = '') {
      this.readyState = MockWebSocket.CLOSED;
      this.onclose?.(new CloseEvent('close', { code, reason }));
    }
  }

  type MockWebSocketInstance = InstanceType<typeof MockWebSocket>;

  return {
    MockWebSocket: MockWebSocket as unknown as typeof WebSocket,
    instances,
    /** Get the most recently created instance. */
    get latest() {
      return instances[instances.length - 1];
    },
  };
}
