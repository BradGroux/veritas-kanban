/**
 * RunModeGateSection — v1
 *
 * Displays and manages:
 * - Run mode (strategy / eng-review / paranoid-review / qa)
 * - QA gate state (required + passed/not passed)
 *
 * Kept intentionally simple: no workflow engine, just a couple of selects
 * and a toggle button that PATCHes the task.
 */

import { useState } from 'react';
import { Badge, Button, Group, Paper, Select, Stack, Switch, Text } from '@mantine/core';
import { CheckCircle2, XCircle, ShieldCheck, Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/useToast';
import { tasksApi } from '@/lib/api/tasks';
import type { Task, RunMode, QaGateState } from '@veritas-kanban/shared';

interface RunModeGateSectionProps {
  task: Task;
  onUpdate: <K extends keyof Task>(field: K, value: Task[K]) => void;
  readOnly?: boolean;
}

const RUN_MODE_LABELS: Record<RunMode, string> = {
  strategy: '📋 Strategy',
  'eng-review': '🔧 Eng Review',
  'paranoid-review': '🔍 Paranoid Review',
  qa: '✅ QA',
};

const RUN_MODE_DESCRIPTIONS: Record<RunMode, string> = {
  strategy: 'High-level strategic review required before completion',
  'eng-review': 'Engineering review (PR / code quality) required',
  'paranoid-review': 'Extra-thorough review — security-sensitive or critical infra',
  qa: 'QA pass required before marking done',
};

const RUN_MODE_OPTIONS = [
  { value: 'none', label: 'None' },
  ...(Object.keys(RUN_MODE_LABELS) as RunMode[]).map((mode) => ({
    value: mode,
    label: RUN_MODE_LABELS[mode],
    description: RUN_MODE_DESCRIPTIONS[mode],
  })),
];

export function RunModeGateSection({ task, onUpdate, readOnly = false }: RunModeGateSectionProps) {
  const { toast } = useToast();
  const [isSaving, setIsSaving] = useState(false);

  const runMode = task.runMode ?? null;
  const qaGate = task.qaGate ?? null;

  const handleRunModeChange = async (value: string) => {
    const newMode = value === 'none' ? null : (value as RunMode);
    setIsSaving(true);
    try {
      await tasksApi.update(task.id, { runMode: newMode });
      onUpdate('runMode', newMode ?? undefined);
      toast({ title: newMode ? `Run mode set: ${RUN_MODE_LABELS[newMode]}` : 'Run mode cleared' });
    } catch (err) {
      toast({
        title: '❌ Failed to update run mode',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive',
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleQaRequiredToggle = async (checked: boolean) => {
    const newGate: QaGateState = {
      required: checked,
      passed: checked ? (qaGate?.passed ?? false) : false,
      passedAt: checked ? qaGate?.passedAt : undefined,
      passedBy: checked ? qaGate?.passedBy : undefined,
    };
    setIsSaving(true);
    try {
      await tasksApi.update(task.id, { qaGate: newGate });
      onUpdate('qaGate', newGate);
      toast({ title: checked ? 'QA gate enabled' : 'QA gate disabled' });
    } catch (err) {
      toast({
        title: '❌ Failed to update QA gate',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive',
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleQaPassToggle = async () => {
    if (!qaGate?.required) return;
    const nowPassed = !qaGate.passed;
    const newGate: QaGateState = {
      required: true,
      passed: nowPassed,
      passedAt: nowPassed ? new Date().toISOString() : undefined,
      passedBy: nowPassed ? 'human' : undefined,
    };
    setIsSaving(true);
    try {
      await tasksApi.update(task.id, { qaGate: newGate });
      onUpdate('qaGate', newGate);
      toast({ title: nowPassed ? '✅ QA passed' : 'QA pass revoked' });
    } catch (err) {
      toast({
        title: '❌ Failed to update QA gate',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive',
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Stack gap="md">
      {/* Run Mode */}
      <Stack gap="xs">
        <Group gap={6}>
          <ShieldCheck className="h-3.5 w-3.5" />
          <Text size="sm" c="dimmed" fw={500}>
            Run Mode
          </Text>
        </Group>
        {readOnly ? (
          <Group gap="xs">
            {runMode ? (
              <Badge variant="outline" className="text-xs">
                {RUN_MODE_LABELS[runMode]}
              </Badge>
            ) : (
              <Text size="xs" c="dimmed">
                None
              </Text>
            )}
          </Group>
        ) : (
          <Select
            aria-label="Run Mode"
            allowDeselect={false}
            data={RUN_MODE_OPTIONS}
            value={runMode ?? 'none'}
            onChange={(value) => {
              if (value) void handleRunModeChange(value);
            }}
            disabled={isSaving}
            placeholder="Select run mode..."
            renderOption={({ option }) => {
              const runOption = RUN_MODE_OPTIONS.find((item) => item.value === option.value);
              return (
                <Stack gap={2}>
                  <Text size="sm" fw={option.value === 'none' ? 400 : 500}>
                    {option.label}
                  </Text>
                  {runOption && 'description' in runOption && (
                    <Text size="xs" c="dimmed">
                      {runOption.description}
                    </Text>
                  )}
                </Stack>
              );
            }}
          />
        )}
        {runMode && (
          <Text size="xs" c="dimmed">
            {RUN_MODE_DESCRIPTIONS[runMode]}
          </Text>
        )}
      </Stack>

      {/* QA Gate */}
      <Stack gap="xs">
        <Text size="sm" c="dimmed" fw={500}>
          QA Gate
        </Text>

        {readOnly ? (
          <Group gap="xs">
            {qaGate?.required ? (
              qaGate.passed ? (
                <Badge
                  color="green"
                  variant="light"
                  leftSection={<CheckCircle2 className="h-3 w-3" />}
                >
                  QA Passed
                </Badge>
              ) : (
                <Badge color="red" variant="light" leftSection={<XCircle className="h-3 w-3" />}>
                  QA Required — Not Passed
                </Badge>
              )
            ) : (
              <Text size="xs" c="dimmed">
                No QA gate
              </Text>
            )}
          </Group>
        ) : (
          <Stack gap="sm">
            {/* Required toggle */}
            <Group justify="space-between" align="center">
              <Text size="sm">Require QA before done</Text>
              <Switch
                aria-label="Require QA before done"
                checked={qaGate?.required ?? false}
                onChange={(event) => {
                  void handleQaRequiredToggle(event.currentTarget.checked);
                }}
                disabled={isSaving}
              />
            </Group>

            {/* Pass/fail button — only visible when required */}
            {qaGate?.required && (
              <Paper className="bg-muted/30 p-3" radius="md" withBorder>
                {qaGate.passed ? (
                  <Group align="center" gap="sm" wrap="nowrap">
                    <CheckCircle2 className="h-4 w-4 flex-shrink-0 text-green-600" />
                    <Stack gap={2} className="min-w-0 flex-1">
                      <Text size="sm" fw={500} c="green.7">
                        QA Passed
                      </Text>
                      {qaGate.passedAt && (
                        <Text size="xs" c="dimmed">
                          {new Date(qaGate.passedAt).toLocaleString()}
                          {qaGate.passedBy ? ` · ${qaGate.passedBy}` : ''}
                        </Text>
                      )}
                    </Stack>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handleQaPassToggle}
                      disabled={isSaving}
                      className="text-xs"
                    >
                      {isSaving ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Revoke'}
                    </Button>
                  </Group>
                ) : (
                  <Group align="center" gap="sm" wrap="nowrap">
                    <XCircle className="h-4 w-4 flex-shrink-0 text-destructive" />
                    <Stack gap={2} className="flex-1">
                      <Text size="sm" fw={500} c="red">
                        QA Not Passed
                      </Text>
                      <Text size="xs" c="dimmed">
                        Task cannot be moved to Done until QA is approved
                      </Text>
                    </Stack>
                    <Button
                      size="sm"
                      onClick={handleQaPassToggle}
                      disabled={isSaving}
                      color="green"
                      className="text-xs"
                      leftSection={
                        isSaving ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <CheckCircle2 className="h-3 w-3" />
                        )
                      }
                    >
                      {isSaving ? 'Saving...' : 'Pass QA'}
                    </Button>
                  </Group>
                )}
              </Paper>
            )}
          </Stack>
        )}
      </Stack>
    </Stack>
  );
}
