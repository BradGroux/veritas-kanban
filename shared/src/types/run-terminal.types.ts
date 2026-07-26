export const RUN_TERMINAL_HANDLE_SCHEMA_VERSION = 'run-terminal-handle/v1' as const;
export const RUN_TERMINAL_OUTPUT_SCHEMA_VERSION = 'run-terminal-output/v1' as const;

export const RUN_TERMINAL_MODES = ['pipe', 'pty'] as const;
export const RUN_TERMINAL_START_MODES = ['background', 'foreground'] as const;
export const RUN_TERMINAL_STATES = [
  'starting',
  'running',
  'exited',
  'failed',
  'terminating',
  'terminated',
] as const;

export type RunTerminalMode = (typeof RUN_TERMINAL_MODES)[number];
export type RunTerminalStartMode = (typeof RUN_TERMINAL_START_MODES)[number];
export type RunTerminalState = (typeof RUN_TERMINAL_STATES)[number];
export type RunTerminalStream = 'stdout' | 'stderr';
export type RunTerminalCapabilityState = 'enforced' | 'unsupported';

export interface RunTerminalCapabilityPosture {
  pipe: RunTerminalCapabilityState;
  pty: RunTerminalCapabilityState;
  interactiveStdin: RunTerminalCapabilityState;
  restartReattachment: RunTerminalCapabilityState;
}

export interface RunTerminalExecuteRequest {
  command: string;
  args: string[];
  mode: RunTerminalMode;
  startMode: RunTerminalStartMode;
  /** Relative to the run-owned worktree. */
  cwd?: string;
  /** Names only. Values come from the manifest-approved launch context. */
  environmentKeys: string[];
}

export interface RunTerminalOutputMetadata {
  nextCursor: number;
  retainedFromCursor: number;
  observedBytes: number;
  retainedBytes: number;
  droppedBytes: number;
  truncated: boolean;
  volumeCircuitTripped: boolean;
}

export interface RunTerminalHandle {
  schemaVersion: typeof RUN_TERMINAL_HANDLE_SCHEMA_VERSION;
  id: string;
  workspaceId: string;
  taskId: string;
  attemptId: string;
  launchManifestDigest: string;
  mode: RunTerminalMode;
  startMode: RunTerminalStartMode;
  state: RunTerminalState;
  commandId: string;
  processId?: number;
  processGroupId?: number;
  startedAt: string;
  endedAt?: string;
  exitCode?: number;
  signal?: string;
  failure?: string;
  output: RunTerminalOutputMetadata;
  capabilities: RunTerminalCapabilityPosture;
}

export interface RunTerminalOutputChunk {
  cursor: number;
  stream: RunTerminalStream;
  content: string;
  byteLength: number;
  occurredAt: string;
}

export interface RunTerminalOutputPage {
  schemaVersion: typeof RUN_TERMINAL_OUTPUT_SCHEMA_VERSION;
  handleId: string;
  afterCursor: number;
  nextCursor: number;
  retainedFromCursor: number;
  gap: boolean;
  chunks: RunTerminalOutputChunk[];
  handle: RunTerminalHandle;
}

export interface RunTerminalWaitResult {
  completed: boolean;
  timedOut: boolean;
  handle: RunTerminalHandle;
}

export interface RunTerminalTerminationResult {
  handle: RunTerminalHandle;
  gracefulSignalAt?: string;
  forceSignalAt?: string;
}
