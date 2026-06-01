import { useCallback, useEffect, useMemo, useState } from 'react';
import { Badge, Button, Modal, PasswordInput, TextInput } from '@mantine/core';
import {
  AlertCircle,
  Bot,
  CheckCircle2,
  Clipboard,
  DatabaseBackup,
  KanbanSquare,
  Loader2,
  RotateCw,
  Server,
  ShieldCheck,
  Upload,
} from 'lucide-react';

import { cn } from '@/lib/utils';

export const DESKTOP_ONBOARDING_STORAGE_KEY = 'veritas-desktop-onboarding-complete';

type HealthState = 'ok' | 'warning' | 'failed' | 'unknown' | 'unsupported';
type SetupMode = 'board' | 'agent' | 'remote' | 'restore';

interface DesktopDiagnosticCheck {
  name: string;
  state: HealthState;
  detail: string;
  checkedAt: string;
}

interface DesktopSetupDiagnostics {
  generatedAt: string;
  checks: DesktopDiagnosticCheck[];
  supportSnapshot: unknown;
}

interface DesktopConnectionValidationResult {
  mode: 'local' | 'remote';
  valid: boolean;
  normalizedServerUrl: string | null;
  warnings: string[];
  errors: string[];
}

interface DesktopSelectedFile {
  path: string;
  name: string;
  size: number;
  lastModified: string | null;
}

interface DesktopFilePickerResult {
  cancelled: boolean;
  files: DesktopSelectedFile[];
}

interface DesktopBridgeApi {
  getSetupDiagnostics(): Promise<DesktopSetupDiagnostics>;
  validateConnectionConfig(request: {
    mode: 'local' | 'remote';
    serverUrl?: string;
    serverToken?: string;
  }): Promise<DesktopConnectionValidationResult>;
  pickUploadFiles?(request: {
    purpose: 'backup-restore';
    allowMultiple?: boolean;
    allowedExtensions?: string[];
  }): Promise<DesktopFilePickerResult>;
}

interface DesktopOnboardingPanelProps {
  onContinue?: () => void;
  compact?: boolean;
}

const setupModes: Array<{
  id: SetupMode;
  title: string;
  badge: string;
  description: string;
  icon: typeof KanbanSquare;
}> = [
  {
    id: 'board',
    title: 'Board Only',
    badge: 'Recommended',
    description: 'Start with a protected local board. Agent, MCP, and delivery setup can wait.',
    icon: KanbanSquare,
  },
  {
    id: 'agent',
    title: 'Agent Ready',
    badge: 'Optional',
    description: 'Review local server, Keychain, CLI, and MCP readiness before agent work.',
    icon: Bot,
  },
  {
    id: 'remote',
    title: 'Remote Server',
    badge: 'Preflight',
    description: 'Validate a trusted Veritas host before remote pairing and device sessions land.',
    icon: Server,
  },
  {
    id: 'restore',
    title: 'Restore or Migrate',
    badge: 'Recovery',
    description: 'Check desktop paths and select a backup bundle before continuing setup.',
    icon: DatabaseBackup,
  },
];

function getDesktopBridge(): DesktopBridgeApi | null {
  if (typeof window === 'undefined') {
    return null;
  }
  return ((window as Window & { veritasDesktop?: DesktopBridgeApi }).veritasDesktop ??
    null) as DesktopBridgeApi | null;
}

function readOnboardingComplete(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }
  try {
    return window.localStorage.getItem(DESKTOP_ONBOARDING_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

export function markDesktopOnboardingComplete(): void {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    window.localStorage.setItem(DESKTOP_ONBOARDING_STORAGE_KEY, 'true');
  } catch {
    // Local storage can be unavailable in restricted browser contexts.
  }
}

export function shouldShowDesktopOnboarding(): boolean {
  return !readOnboardingComplete();
}

function stateLabel(state: HealthState): string {
  switch (state) {
    case 'ok':
      return 'Ready';
    case 'warning':
      return 'Needs Review';
    case 'failed':
      return 'Failed';
    case 'unsupported':
      return 'Unsupported';
    default:
      return 'Unknown';
  }
}

function stateClass(state: HealthState): string {
  switch (state) {
    case 'ok':
      return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300';
    case 'warning':
      return 'border-amber-500/30 bg-amber-500/10 text-amber-300';
    case 'failed':
      return 'border-red-500/30 bg-red-500/10 text-red-300';
    default:
      return 'border-border bg-muted/40 text-muted-foreground';
  }
}

function formatCheckName(name: string): string {
  return name
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function fallbackDiagnostics(): DesktopSetupDiagnostics {
  const checkedAt = new Date().toISOString();
  return {
    generatedAt: checkedAt,
    checks: [
      {
        name: 'desktop-bridge',
        state: 'unsupported',
        detail: 'Desktop bridge is not available in this browser session.',
        checkedAt,
      },
    ],
    supportSnapshot: null,
  };
}

async function validateRemoteWithoutDesktop(
  serverUrl: string
): Promise<DesktopConnectionValidationResult> {
  try {
    const parsed = new URL(serverUrl);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error('Remote server URL protocol is not allowed.');
    }
    if (parsed.username || parsed.password) {
      throw new Error('Remote server URL credentials are not allowed.');
    }
    return {
      mode: 'remote',
      valid: true,
      normalizedServerUrl: parsed.toString(),
      warnings: ['Live reachability checks require the desktop app.'],
      errors: [],
    };
  } catch (error) {
    return {
      mode: 'remote',
      valid: false,
      normalizedServerUrl: null,
      warnings: [],
      errors: [error instanceof Error ? error.message : 'Remote server URL is invalid.'],
    };
  }
}

function remoteValidationTitle(result: DesktopConnectionValidationResult): string {
  if (!result.valid) {
    return 'Remote validation failed.';
  }

  if (result.warnings.includes('Live reachability checks require the desktop app.')) {
    return 'URL syntax is valid.';
  }

  return 'Remote target is reachable.';
}

export function DesktopOnboardingPanel({
  onContinue,
  compact = false,
}: DesktopOnboardingPanelProps) {
  const [selectedMode, setSelectedMode] = useState<SetupMode>('board');
  const [diagnostics, setDiagnostics] = useState<DesktopSetupDiagnostics | null>(null);
  const [diagnosticsLoading, setDiagnosticsLoading] = useState(false);
  const [copiedDiagnostics, setCopiedDiagnostics] = useState(false);
  const [remoteUrl, setRemoteUrl] = useState('');
  const [remoteToken, setRemoteToken] = useState('');
  const [remoteResult, setRemoteResult] = useState<DesktopConnectionValidationResult | null>(null);
  const [remoteLoading, setRemoteLoading] = useState(false);
  const [restoreFiles, setRestoreFiles] = useState<DesktopSelectedFile[]>([]);
  const desktopBridge = useMemo(() => getDesktopBridge(), []);

  const loadDiagnostics = useCallback(async () => {
    setDiagnosticsLoading(true);
    try {
      setDiagnostics(
        desktopBridge ? await desktopBridge.getSetupDiagnostics() : fallbackDiagnostics()
      );
    } finally {
      setDiagnosticsLoading(false);
    }
  }, [desktopBridge]);

  useEffect(() => {
    void loadDiagnostics();
  }, [loadDiagnostics]);

  const validateRemote = async () => {
    setRemoteLoading(true);
    setRemoteResult(null);
    try {
      const result = desktopBridge
        ? await desktopBridge.validateConnectionConfig({
            mode: 'remote',
            serverUrl: remoteUrl,
            serverToken: remoteToken || undefined,
          })
        : await validateRemoteWithoutDesktop(remoteUrl);
      setRemoteResult(result);
    } finally {
      setRemoteLoading(false);
    }
  };

  const pickRestoreFile = async () => {
    if (!desktopBridge?.pickUploadFiles) {
      setRestoreFiles([]);
      return;
    }
    const result = await desktopBridge.pickUploadFiles({
      purpose: 'backup-restore',
      allowMultiple: false,
      allowedExtensions: ['.json', '.zip', '.db'],
    });
    setRestoreFiles(result.cancelled ? [] : result.files);
  };

  const copyDiagnostics = async () => {
    if (!diagnostics) return;
    await navigator.clipboard.writeText(JSON.stringify(diagnostics, null, 2));
    setCopiedDiagnostics(true);
    setTimeout(() => setCopiedDiagnostics(false), 2000);
  };

  const canContinue = selectedMode !== 'remote' || remoteResult?.valid;

  return (
    <div
      className={cn(
        'grid w-full max-w-full min-w-0 gap-6 text-foreground lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]',
        compact ? 'max-w-5xl' : 'max-w-6xl'
      )}
    >
      <section className="min-w-0 space-y-5">
        <div className="space-y-3">
          <Badge variant="outline" color="cyan" tt="none">
            v5 Desktop Setup
          </Badge>
          <div className="space-y-2">
            <h1
              className={cn(
                'break-words font-bold tracking-normal',
                compact ? 'text-2xl' : 'text-3xl'
              )}
            >
              Choose setup path
            </h1>
            <p className="max-w-xl break-words text-sm leading-6 text-muted-foreground">
              Start with the board, then layer in agents, remote access, and recovery paths when
              they are needed.
            </p>
          </div>
        </div>

        <div className="grid gap-2">
          {['Select path', 'Check readiness', 'Secure board'].map((step, index) => (
            <div key={step} className="flex items-center gap-3 rounded-lg border bg-card/60 p-3">
              <span className="flex size-6 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold text-primary">
                {index + 1}
              </span>
              <span className="text-sm font-medium">{step}</span>
            </div>
          ))}
        </div>

        <div className="rounded-lg border bg-card/60 p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold">Readiness</h2>
              <p className="text-xs text-muted-foreground">Redacted desktop diagnostics</p>
            </div>
            <Button
              variant="subtle"
              color="gray"
              size="sm"
              onClick={loadDiagnostics}
              disabled={diagnosticsLoading}
            >
              {diagnosticsLoading ? (
                <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
              ) : (
                <RotateCw className="mr-1 h-3.5 w-3.5" />
              )}
              Refresh
            </Button>
          </div>
          <div className="space-y-2">
            {(diagnostics?.checks ?? []).slice(0, 6).map((check) => (
              <div
                key={check.name}
                className="flex items-start justify-between gap-3 rounded-md border bg-background/50 p-2"
              >
                <div className="min-w-0">
                  <div className="text-sm font-medium">{formatCheckName(check.name)}</div>
                  <div className="truncate text-xs text-muted-foreground">{check.detail}</div>
                </div>
                <span
                  className={cn(
                    'shrink-0 rounded-full border px-2 py-0.5 text-[0.68rem] font-semibold',
                    stateClass(check.state)
                  )}
                >
                  {stateLabel(check.state)}
                </span>
              </div>
            ))}
          </div>
          <Button
            variant="outline"
            size="sm"
            className="mt-3 w-full"
            onClick={copyDiagnostics}
            disabled={!diagnostics}
          >
            <Clipboard className="mr-1.5 h-3.5 w-3.5" />
            {copiedDiagnostics ? 'Copied' : 'Copy Diagnostics'}
          </Button>
        </div>
      </section>

      <section className="min-w-0 space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          {setupModes.map((mode) => {
            const Icon = mode.icon;
            const selected = selectedMode === mode.id;
            return (
              <button
                key={mode.id}
                type="button"
                data-testid={`setup-mode-${mode.id}`}
                onClick={() => setSelectedMode(mode.id)}
                className={cn(
                  'min-h-36 rounded-lg border bg-card p-4 text-left transition-colors hover:border-primary/50 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none',
                  selected && 'border-primary bg-primary/5'
                )}
              >
                <div className="mb-4 flex items-center justify-between gap-3">
                  <span className="flex size-9 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                    <Icon className="h-4 w-4" />
                  </span>
                  <Badge
                    variant={mode.id === 'board' ? 'filled' : 'outline'}
                    color={mode.id === 'board' ? 'violet' : 'gray'}
                    tt="none"
                  >
                    {mode.badge}
                  </Badge>
                </div>
                <div className="space-y-1">
                  <h2 className="text-base font-semibold">{mode.title}</h2>
                  <p className="text-sm leading-5 text-muted-foreground">{mode.description}</p>
                </div>
              </button>
            );
          })}
        </div>

        <div className="rounded-lg border bg-card p-4">
          {selectedMode === 'board' && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <ShieldCheck className="h-4 w-4 text-emerald-400" />
                Local board setup
              </div>
              <p className="text-sm text-muted-foreground">
                Veritas will create a local SQLite-backed workspace, store desktop secrets through
                the native secret store when available, and keep optional integrations disabled.
              </p>
            </div>
          )}

          {selectedMode === 'agent' && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <Bot className="h-4 w-4 text-cyan-300" />
                Agent readiness
              </div>
              <p className="text-sm text-muted-foreground">
                Agent setup remains optional. Use diagnostics after password setup to verify API,
                CLI, MCP, and runner access before starting agent work.
              </p>
            </div>
          )}

          {selectedMode === 'remote' && (
            <div className="space-y-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <Server className="h-4 w-4 text-violet-300" />
                  Remote validation
                </div>
                <p className="text-sm text-muted-foreground">
                  Validate reachability now. Pairing, device sessions, and tunnels are completed by
                  the remote-security workstream.
                </p>
              </div>
              <div className="grid gap-3">
                <TextInput
                  id="remote-url"
                  label="Server URL"
                  value={remoteUrl}
                  onChange={(event) => {
                    setRemoteUrl(event.target.value);
                    setRemoteResult(null);
                  }}
                  placeholder="https://veritas.example.com"
                />
                <PasswordInput
                  id="remote-token"
                  label="Token"
                  value={remoteToken}
                  onChange={(event) => setRemoteToken(event.target.value)}
                  placeholder="Optional scoped token"
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={validateRemote}
                  disabled={!remoteUrl || remoteLoading}
                >
                  {remoteLoading ? (
                    <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                  ) : (
                    <Server className="mr-1.5 h-4 w-4" />
                  )}
                  Validate Remote
                </Button>
                {remoteResult && (
                  <div
                    className={cn(
                      'rounded-lg border p-3 text-sm',
                      remoteResult.valid
                        ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-100'
                        : 'border-red-500/30 bg-red-500/10 text-red-100'
                    )}
                  >
                    <div className="mb-1 flex items-center gap-2 font-medium">
                      {remoteResult.valid ? (
                        <CheckCircle2 className="h-4 w-4" />
                      ) : (
                        <AlertCircle className="h-4 w-4" />
                      )}
                      {remoteValidationTitle(remoteResult)}
                    </div>
                    {[...remoteResult.warnings, ...remoteResult.errors].map((message) => (
                      <div key={message} className="text-xs opacity-90">
                        {message}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {selectedMode === 'restore' && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <Upload className="h-4 w-4 text-amber-300" />
                Restore preflight
              </div>
              <p className="text-sm text-muted-foreground">
                Desktop startup already copies legacy profile data forward without deleting it.
                Select a backup bundle now, then complete restore from Data settings after setup.
              </p>
              <Button type="button" variant="outline" onClick={pickRestoreFile}>
                <Upload className="mr-1.5 h-4 w-4" />
                Select Backup Bundle
              </Button>
              {restoreFiles.length > 0 && (
                <div className="rounded-md border bg-background/50 p-2 text-sm">
                  {restoreFiles.map((file) => (
                    <div key={file.path} className="truncate">
                      {file.name}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {onContinue && (
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button
              type="button"
              className="sm:min-w-44"
              disabled={!canContinue}
              onClick={() => {
                markDesktopOnboardingComplete();
                onContinue();
              }}
            >
              Continue to Password
            </Button>
          </div>
        )}
      </section>
    </div>
  );
}

export function DesktopOnboardingScreen({ onContinue }: { onContinue: () => void }) {
  return (
    <div className="min-h-screen bg-background px-4 py-8">
      <div className="flex min-h-[calc(100vh-4rem)] items-center justify-center">
        <DesktopOnboardingPanel onContinue={onContinue} />
      </div>
    </div>
  );
}

export function DesktopOnboardingDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Modal
      opened={open}
      onClose={() => onOpenChange(false)}
      title="Setup & Diagnostics"
      size="xl"
      centered
    >
      <p className="mb-4 text-sm text-muted-foreground">
        Recheck desktop readiness, copy redacted diagnostics, and validate remote targets.
      </p>
      <DesktopOnboardingPanel compact />
    </Modal>
  );
}
