export interface DesktopSetupDataCounts {
  tasks: number;
  squadMessages: number;
  telemetryEvents: number;
  workflowDefinitions: number;
  workflowRuns: number;
}

export interface DesktopSetupContext {
  storageMode: 'sqlite';
  hasExistingData: boolean;
  counts: DesktopSetupDataCounts;
}

export interface AuthStatus {
  needsSetup: boolean;
  authenticated: boolean;
  sessionExpiry: string | null;
  authEnabled: boolean;
  setupContext?: DesktopSetupContext;
}
