import { useEffect, useRef, useState } from 'react';
import { UiDrawer as Drawer } from '@/components/ui/UiOverlay';
import {
  ActionIcon,
  Alert,
  Button,
  Code,
  Group,
  Loader,
  Paper,
  ScrollArea,
  Stack,
  Text,
} from '@mantine/core';
import {
  usePreviewStatus,
  usePreviewOutput,
  useStartPreview,
  useStopPreview,
} from '@/hooks/usePreview';
import {
  Play,
  Square,
  RefreshCw,
  ExternalLink,
  Terminal,
  Monitor,
  AlertCircle,
} from 'lucide-react';
import type { Task } from '@veritas-kanban/shared';

interface PreviewPanelProps {
  task: Task;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function PreviewPanel({ task, open, onOpenChange }: PreviewPanelProps) {
  const [showOutput, setShowOutput] = useState(false);
  const [iframeKey, setIframeKey] = useState(0);
  const [operation, setOperation] = useState<'start' | 'stop' | null>(null);
  const [requestError, setRequestError] = useState<string | null>(null);
  const requestInFlight = useRef(false);
  const errorRef = useRef<HTMLDivElement>(null);
  const isPending = operation !== null;

  useEffect(() => {
    if (requestError) {
      errorRef.current?.focus({ preventScroll: true });
      errorRef.current?.scrollIntoView({ block: 'center', behavior: 'instant' });
    }
  }, [requestError]);

  const { data: status, isLoading } = usePreviewStatus(open ? task.id : undefined);
  const { data: outputData } = usePreviewOutput(open && showOutput ? task.id : undefined);

  const startPreview = useStartPreview();
  const stopPreview = useStopPreview();

  const isRunning = status && 'url' in status && status.status === 'running';
  const isStarting = status && 'status' in status && status.status === 'starting';
  const hasError = status && 'error' in status && status.error;
  const previewUrl = status && 'url' in status ? status.url : null;

  const runOperation = async (nextOperation: 'start' | 'stop') => {
    if (
      requestInFlight.current ||
      (nextOperation === 'start' && (!task.git?.repo || isRunning || isStarting)) ||
      (nextOperation === 'stop' && !isRunning)
    )
      return;
    requestInFlight.current = true;
    setOperation(nextOperation);
    setRequestError(null);
    try {
      if (nextOperation === 'start') await startPreview.mutateAsync(task.id);
      else await stopPreview.mutateAsync(task.id);
    } catch (error) {
      setRequestError(
        error instanceof Error ? error.message : `Unable to ${nextOperation} preview.`
      );
    } finally {
      requestInFlight.current = false;
      setOperation(null);
    }
  };

  const handleClose = () => {
    if (!requestInFlight.current) {
      setRequestError(null);
      onOpenChange(false);
    }
  };

  const handleRefresh = () => {
    setIframeKey((k) => k + 1);
  };

  const handleOpenExternal = () => {
    if (previewUrl) {
      window.open(previewUrl, '_blank', 'noopener,noreferrer');
    }
  };

  return (
    <Drawer
      opened={open}
      onClose={handleClose}
      closeOnEscape={!isPending}
      closeOnClickOutside={!isPending}
      closeButtonProps={{ disabled: isPending }}
      position="right"
      compound
      title={
        <Group gap="xs">
          <Monitor className="h-5 w-5" />
          <Text fw={600}>Preview</Text>
        </Group>
      }
    >
      <Stack gap={0} className="min-h-0 flex-1 overflow-hidden">
        <Group justify="space-between" align="center" className="shrink-0 border-b p-4">
          <Text size="sm" c="dimmed">
            {task.git?.repo ? `Dev server for ${task.git.repo}` : 'No repository configured'}
          </Text>

          {/* Controls */}
          <Group gap="xs">
            {isRunning && (
              <>
                <ActionIcon
                  variant="outline"
                  size="lg"
                  aria-label="Refresh preview"
                  disabled={isPending}
                  onClick={handleRefresh}
                >
                  <RefreshCw className="h-4 w-4" />
                </ActionIcon>
                <ActionIcon
                  variant="outline"
                  size="lg"
                  aria-label="Open preview externally"
                  disabled={isPending}
                  onClick={handleOpenExternal}
                >
                  <ExternalLink className="h-4 w-4" />
                </ActionIcon>
                <ActionIcon
                  variant={showOutput ? 'filled' : 'outline'}
                  size="lg"
                  aria-label="Toggle preview output"
                  disabled={isPending}
                  onClick={() => setShowOutput(!showOutput)}
                >
                  <Terminal className="h-4 w-4" />
                </ActionIcon>
                <ActionIcon
                  color="red"
                  variant="filled"
                  size="lg"
                  aria-label="Stop preview"
                  onClick={() => void runOperation('stop')}
                  disabled={isPending}
                  loading={operation === 'stop'}
                >
                  <Square className="h-4 w-4" />
                </ActionIcon>
              </>
            )}

            {!isRunning && !isStarting && (
              <Button
                onClick={() => void runOperation('start')}
                disabled={isPending || !task.git?.repo}
                loading={operation === 'start'}
                leftSection={<Play className="h-4 w-4" />}
              >
                Start Preview
              </Button>
            )}
          </Group>
        </Group>

        {/* Content Area */}
        <Stack gap={0} className="vk-overlay-scroll">
          {requestError && (
            <Alert
              ref={errorRef}
              tabIndex={-1}
              color="red"
              title="Preview request failed"
              className="m-4 shrink-0"
            >
              {requestError}
            </Alert>
          )}
          {/* Loading state */}
          {(isLoading || isStarting) && (
            <Stack align="center" justify="center" gap="sm" className="flex-1">
              <Loader color="gray" size="md" />
              <Text c="dimmed">{isStarting ? 'Starting dev server...' : 'Loading...'}</Text>
              {isStarting && status && 'output' in status && status.output.length > 0 && (
                <Text size="xs" c="dimmed" className="font-mono">
                  {status.output[status.output.length - 1]?.slice(0, 80)}
                </Text>
              )}
            </Stack>
          )}

          {/* Error state */}
          {hasError && !isStarting && (
            <Stack align="center" justify="center" gap="sm" className="flex-1 p-6" ta="center">
              <AlertCircle className="h-12 w-12 mx-auto mb-4 text-red-500" />
              <Text fw={600}>Preview Error</Text>
              <Text size="sm" c="dimmed" className="max-w-md">
                {status && 'error' in status ? status.error : 'An error occurred'}
              </Text>
              <Button
                onClick={() => void runOperation('start')}
                disabled={isPending || !task.git?.repo}
                leftSection={<RefreshCw className="h-4 w-4" />}
              >
                Try Again
              </Button>
            </Stack>
          )}

          {/* Stopped state */}
          {!isRunning && !isStarting && !hasError && !isLoading && (
            <Stack align="center" justify="center" gap="sm" className="flex-1 p-6" ta="center">
              <Monitor className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
              <Text fw={600}>Preview Not Running</Text>
              <Text size="sm" c="dimmed" className="max-w-md">
                {task.git?.repo
                  ? 'Start the dev server to see a live preview of your changes.'
                  : 'Configure a repository for this task to use preview.'}
              </Text>
            </Stack>
          )}

          {/* Running - show iframe */}
          {isRunning && previewUrl && (
            <Stack gap={0} className="min-h-0 flex-1 overflow-hidden">
              {/* Output panel (collapsible) */}
              {showOutput && (
                <Paper className="h-48 rounded-none border-b bg-black font-mono text-xs text-green-400">
                  <ScrollArea className="h-full">
                    <div className="p-4">
                      {outputData?.output.map((line, i) => (
                        <div key={i} className="whitespace-pre-wrap break-all">
                          {line}
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                </Paper>
              )}

              {/* URL bar */}
              <Group gap="xs" className="border-b bg-muted/50 px-4 py-2" wrap="nowrap">
                <Text size="xs" c="dimmed">
                  URL:
                </Text>
                <Code className="min-w-0 flex-1 truncate">{previewUrl}</Code>
              </Group>

              {/* iframe */}
              <div className="flex-1 bg-white">
                <iframe
                  key={iframeKey}
                  src={previewUrl}
                  className="w-full h-full border-0"
                  title="Preview"
                  sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
                />
              </div>
            </Stack>
          )}
        </Stack>
      </Stack>
    </Drawer>
  );
}
