import { useEffect, useRef, useState } from 'react';
import type { WorkflowDefinition } from '@veritas-kanban/shared';
import { Alert, Stack, Text, Textarea, TextInput } from '@mantine/core';
import { UiModal as Modal, OverlayFooter } from '@/components/ui/UiOverlay';
import { UiAction } from '@/components/ui/UiVocabulary';
import { AlertTriangle, Play } from 'lucide-react';
import { workflowsApi, type WorkflowRunStartResponse } from '@/lib/api/workflows';

interface WorkflowStartDialogProps {
  workflow: WorkflowDefinition | null;
  onClose: () => void;
  onStarted: (run: WorkflowRunStartResponse) => void;
}

function initialContext(workflow: WorkflowDefinition | null): string {
  return JSON.stringify(workflow?.variables ?? {}, null, 2);
}

export function WorkflowStartDialog({ workflow, onClose, onStarted }: WorkflowStartDialogProps) {
  const [taskId, setTaskId] = useState('');
  const [contextDraft, setContextDraft] = useState(() => initialContext(workflow));
  const [error, setError] = useState<string | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const startInFlight = useRef(false);
  const errorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (error) {
      errorRef.current?.focus({ preventScroll: true });
      errorRef.current?.scrollIntoView({ block: 'center', behavior: 'instant' });
    }
  }, [error]);

  useEffect(() => {
    if (startInFlight.current) return;
    setTaskId('');
    setContextDraft(initialContext(workflow));
    setError(null);
    setIsStarting(false);
  }, [workflow]);

  const startRun = async () => {
    if (!workflow || startInFlight.current) return;
    setError(null);

    let context: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(contextDraft || '{}');
      if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
        throw new Error('Run context must be a JSON object.');
      }
      context = parsed as Record<string, unknown>;
    } catch (parseError) {
      setError(
        parseError instanceof SyntaxError
          ? 'Run context is not valid JSON. Correct it before starting the run.'
          : parseError instanceof Error
            ? parseError.message
            : 'Run context must be a JSON object.'
      );
      return;
    }

    startInFlight.current = true;
    setIsStarting(true);
    try {
      const run = await workflowsApi.startRun(workflow.id, {
        taskId: taskId.trim() || undefined,
        context,
      });
      onStarted(run);
    } catch (startError) {
      setError(
        startError instanceof Error
          ? startError.message
          : `Workflow ${workflow.name} could not be started.`
      );
    } finally {
      startInFlight.current = false;
      setIsStarting(false);
    }
  };

  const handleClose = () => {
    if (!startInFlight.current) onClose();
  };

  return (
    <Modal
      compound
      opened={workflow !== null}
      onClose={handleClose}
      closeOnEscape={!isStarting}
      closeOnClickOutside={!isStarting}
      closeButtonProps={{ disabled: isStarting }}
      title={workflow ? `Start ${workflow.name}` : 'Start workflow'}
      centered
    >
      <Stack gap="md" className="vk-overlay-scroll">
        <Text size="sm" c="dimmed">
          Review the task association and run context before execution. Starting a run is separate
          from viewing or editing the workflow.
        </Text>

        <TextInput
          label="Task ID"
          disabled={isStarting}
          description="Optional. Associate this run with an existing task."
          placeholder="task_..."
          value={taskId}
          onChange={(event) => setTaskId(event.currentTarget.value)}
        />

        <Textarea
          label="Run context"
          disabled={isStarting}
          description="JSON object supplied to the workflow as its initial context."
          value={contextDraft}
          onChange={(event) => setContextDraft(event.currentTarget.value)}
          minRows={8}
          className="font-mono"
          spellCheck={false}
        />

        {error && (
          <Alert
            ref={errorRef}
            className="shrink-0"
            tabIndex={-1}
            color="red"
            icon={<AlertTriangle className="h-4 w-4" />}
            title="Run not started"
          >
            {error}
          </Alert>
        )}
      </Stack>
      <OverlayFooter>
        <UiAction variant="quiet" onClick={handleClose} disabled={isStarting}>
          Cancel
        </UiAction>
        <UiAction
          leftSection={<Play className="h-4 w-4" />}
          loading={isStarting}
          onClick={() => void startRun()}
        >
          Start Run
        </UiAction>
      </OverlayFooter>
    </Modal>
  );
}
