import { UiModal as Modal, OverlayFooter } from '@/components/ui/UiOverlay';
import { UiPill, semanticToneForLegacyColor, UiAction } from '@/components/ui/UiVocabulary';
import { SettingsGroup, SettingsNotice } from '@/components/settings/shared/SettingsLayout';
import { useEffect, useMemo, useState } from 'react';
import type { ElementType } from 'react';
import {
  Checkbox,
  Code,
  Group,
  Loader,
  NumberInput,
  Progress,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Text,
  TextInput,
  Textarea,
  Tooltip,
} from '@mantine/core';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useToast } from '@/hooks/useToast';
import {
  Archive,
  Database,
  FileArchive,
  FileClock,
  HardDrive,
  RefreshCcw,
  ShieldCheck,
  Trash2,
  Wrench,
} from 'lucide-react';
import type {
  MaintenanceCleanupPreviewItem,
  MaintenanceHealthCheck,
  MaintenanceStorageCategory,
} from '@veritas-kanban/shared';
import { SettingsLocalNav, SettingsPage, SettingsSection } from '../shared';

const HEALTH_COLORS: Record<MaintenanceHealthCheck['state'], string> = {
  ok: 'green',
  warn: 'yellow',
  fail: 'red',
  unknown: 'gray',
};

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  const scaled = value / 1024 ** index;
  return `${scaled >= 10 ? scaled.toFixed(0) : scaled.toFixed(1)} ${units[index]}`;
}

function formatDate(value?: string): string {
  if (!value) return 'No activity';
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value));
}

function SummaryMetric({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string;
  icon: ElementType;
}) {
  return (
    <SettingsGroup>
      <Group gap="sm" wrap="nowrap">
        <Icon className="h-4 w-4 text-muted-foreground" />
        <div>
          <Text size="xs" c="dimmed">
            {label}
          </Text>
          <Text size="sm" fw={600}>
            {value}
          </Text>
        </div>
      </Group>
    </SettingsGroup>
  );
}

function HealthCheckList({ checks }: { checks: MaintenanceHealthCheck[] }) {
  return (
    <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="xs">
      {checks.map((check) => (
        <SettingsGroup key={check.id}>
          <Group justify="space-between" gap="sm">
            <Text size="sm" fw={600}>
              {check.label}
            </Text>
            <UiPill kind="status" tone={semanticToneForLegacyColor(HEALTH_COLORS[check.state])}>
              {check.state}
            </UiPill>
          </Group>
          <Text size="xs" c="dimmed" mt={4}>
            {check.detail}
          </Text>
        </SettingsGroup>
      ))}
    </SimpleGrid>
  );
}

function StorageTable({ categories }: { categories: MaintenanceStorageCategory[] }) {
  return (
    <Table.ScrollContainer minWidth={640}>
      <Table striped highlightOnHover withTableBorder>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Artifact</Table.Th>
            <Table.Th>Items</Table.Th>
            <Table.Th>Size</Table.Th>
            <Table.Th>Cleanup</Table.Th>
            <Table.Th>Last used</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {categories.map((category) => (
            <Table.Tr key={category.id}>
              <Table.Td>
                <Text size="sm" fw={600}>
                  {category.label}
                </Text>
                <Text size="xs" c="dimmed">
                  {category.retainedReason}
                </Text>
              </Table.Td>
              <Table.Td>{category.itemCount}</Table.Td>
              <Table.Td>{formatBytes(category.bytes)}</Table.Td>
              <Table.Td>
                <UiPill
                  kind="status"
                  tone={semanticToneForLegacyColor(
                    category.cleanupEligibleCount > 0 ? 'yellow' : 'gray'
                  )}
                >
                  {category.cleanupEligibleCount}
                </UiPill>
              </Table.Td>
              <Table.Td>{formatDate(category.lastUsedAt)}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Table.ScrollContainer>
  );
}

function CleanupPreviewList({ items }: { items: MaintenanceCleanupPreviewItem[] }) {
  if (items.length === 0) {
    return (
      <Text size="sm" c="dimmed">
        No cleanup candidates found.
      </Text>
    );
  }

  return (
    <Stack gap="xs">
      {items.slice(0, 8).map((item) => (
        <SettingsGroup key={item.id}>
          <Group justify="space-between" align="flex-start" gap="sm">
            <div>
              <Group gap="xs">
                <Text size="sm" fw={600}>
                  {item.label}
                </Text>
                <UiPill
                  kind="status"
                  tone={semanticToneForLegacyColor(item.cleanupEligible ? 'yellow' : 'gray')}
                >
                  {item.category}
                </UiPill>
              </Group>
              <Text size="xs" c="dimmed">
                {item.retainedReason}
              </Text>
            </div>
            <Text size="sm" fw={600}>
              {formatBytes(item.estimatedBytes)}
            </Text>
          </Group>
        </SettingsGroup>
      ))}
    </Stack>
  );
}

export function MaintenanceTab() {
  const { toast } = useToast();
  const [selectedLog, setSelectedLog] = useState<string>('server');
  const [tailLines, setTailLines] = useState(200);
  const [cleanupOpen, setCleanupOpen] = useState(false);
  const [cleanupConfirm, setCleanupConfirm] = useState('');
  const [sqlitePath, setSqlitePath] = useState('');
  const [outputDir, setOutputDir] = useState('');
  const [workspaceId, setWorkspaceId] = useState('');
  const [bundleDir, setBundleDir] = useState('');
  const [replaceExisting, setReplaceExisting] = useState(false);
  const [lastBackupResult, setLastBackupResult] = useState<string | null>(null);

  const summaryQuery = useQuery({
    queryKey: ['maintenance', 'summary'],
    queryFn: api.maintenance.summary,
  });
  const summary = summaryQuery.data;

  useEffect(() => {
    if (!summary?.logs.length) return;
    if (!summary.logs.some((source) => source.id === selectedLog)) {
      setSelectedLog(summary.logs[0].id);
    }
  }, [selectedLog, summary?.logs]);

  const logQuery = useQuery({
    queryKey: ['maintenance', 'logs', selectedLog, tailLines],
    queryFn: () => api.maintenance.tailLog(selectedLog, tailLines),
    enabled: Boolean(selectedLog),
  });

  const debugBundle = useMutation({
    mutationFn: api.maintenance.createDebugBundle,
    onSuccess: (bundle) => {
      toast({
        title: 'Debug bundle created',
        description: bundle.outputPath,
      });
      summaryQuery.refetch();
    },
    onError: (error) => {
      toast({
        title: 'Debug bundle failed',
        description: error instanceof Error ? error.message : 'Unknown error',
        duration: Infinity,
      });
    },
  });

  const exportSqlite = useMutation({
    mutationFn: api.maintenance.exportSqlite,
    onSuccess: (report) => {
      const result = `Exported ${report.counts.length} tables to ${report.bundlePath ?? outputDir}`;
      setLastBackupResult(result);
      toast({ title: 'SQLite export complete', description: result });
      summaryQuery.refetch();
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : 'Unknown error';
      setLastBackupResult(message);
      toast({ title: 'SQLite export failed', description: message, duration: Infinity });
    },
  });

  const importSqlite = useMutation({
    mutationFn: api.maintenance.importSqlite,
    onSuccess: (report) => {
      const result = `Imported ${report.counts.length} tables into ${report.sqlitePath ?? sqlitePath}`;
      setLastBackupResult(result);
      toast({ title: 'SQLite import complete', description: result });
      summaryQuery.refetch();
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : 'Unknown error';
      setLastBackupResult(message);
      toast({ title: 'SQLite import failed', description: message, duration: Infinity });
    },
  });

  const logOptions = useMemo(
    () =>
      (summary?.logs ?? []).map((source) => ({
        value: source.id,
        label: `${source.label}${source.exists ? '' : ' (missing)'}`,
      })),
    [summary?.logs]
  );

  if (summaryQuery.isLoading) {
    return (
      <Group gap="sm">
        <Loader size="sm" />
        <Text size="sm" c="dimmed">
          Loading maintenance state
        </Text>
      </Group>
    );
  }

  if (summaryQuery.isError || !summary) {
    return (
      <SettingsNotice tone="error" title="Maintenance unavailable">
        {summaryQuery.error instanceof Error ? summaryQuery.error.message : 'Failed to load state'}
      </SettingsNotice>
    );
  }

  const cleanupEnabled =
    summary.cleanupPreview.destructiveActionsEnabled && cleanupConfirm === 'DELETE';
  const cleanupBytes = summary.cleanupPreview.items.reduce(
    (total, item) => total + item.estimatedBytes,
    0
  );
  const workProductRatio =
    summary.workProducts.totals.products > 0
      ? (summary.workProducts.totals.cleanupCandidates / summary.workProducts.totals.products) * 100
      : 0;

  return (
    <SettingsPage
      title="Maintenance"
      description={`${summary.storageMode} storage, ${summary.mode} mode, refreshed ${formatDate(summary.generatedAt)}.`}
      actions={
        <Group gap="xs">
          <Tooltip label="Refresh maintenance state">
            <UiAction
              variant="secondary"
              type="button"
              leftSection={<RefreshCcw className="h-4 w-4" />}
              onClick={() => summaryQuery.refetch()}
            >
              Refresh
            </UiAction>
          </Tooltip>
          <UiAction
            variant="primary"
            type="button"
            leftSection={<FileArchive className="h-4 w-4" />}
            loading={debugBundle.isPending}
            onClick={() => debugBundle.mutate()}
          >
            Debug Bundle
          </UiAction>
        </Group>
      }
    >
      <SettingsLocalNav
        label="Maintenance settings sections"
        items={[
          { id: 'maintenance-overview', label: 'Overview' },
          { id: 'maintenance-cleanup', label: 'Cleanup' },
          { id: 'maintenance-logs', label: 'Logs' },
          { id: 'maintenance-backup', label: 'Backup/Restore' },
          { id: 'maintenance-lifecycle', label: 'Lifecycle' },
        ]}
      />

      <SettingsSection
        id="maintenance-overview"
        title="Overview"
        description="Review service health, storage usage, and current maintenance scope."
      >
        <SimpleGrid cols={{ base: 1, sm: 4 }} spacing="xs">
          <SummaryMetric
            label="Storage"
            value={formatBytes(summary.storage.totalBytes)}
            icon={HardDrive}
          />
          <SummaryMetric
            label="Cleanup Preview"
            value={`${summary.cleanupPreview.items.length} items`}
            icon={Trash2}
          />
          <SummaryMetric
            label="Work Products"
            value={`${summary.workProducts.totals.products} products`}
            icon={Archive}
          />
          <SummaryMetric
            label="Lifecycle Classes"
            value={`${summary.lifecycle.length} classes`}
            icon={ShieldCheck}
          />
        </SimpleGrid>

        <div className="mt-4 space-y-3">
          <Text size="sm" fw={700}>
            Health
          </Text>
          <HealthCheckList checks={summary.health} />
        </div>

        <div className="mt-4 space-y-3">
          <Group justify="space-between">
            <Text size="sm" fw={700}>
              Storage Usage
            </Text>
            <UiPill>{formatBytes(summary.storage.totalBytes)}</UiPill>
          </Group>
          <StorageTable categories={summary.storage.categories} />
        </div>
      </SettingsSection>

      <SettingsSection
        id="maintenance-cleanup"
        title="Cleanup"
        description={`${formatBytes(cleanupBytes)} across ${summary.cleanupPreview.items.length} previewed items. Review retained reasons before taking action.`}
        tone="danger"
        actions={
          <UiAction
            variant="secondary"
            type="button"
            leftSection={<Trash2 className="h-4 w-4" />}
            onClick={() => setCleanupOpen(true)}
          >
            Review Cleanup
          </UiAction>
        }
      >
        <Stack gap="sm">
          <CleanupPreviewList items={summary.cleanupPreview.items} />
          <Progress
            value={workProductRatio}
            size="sm"
            color="yellow"
            aria-label="Work product cleanup ratio"
          />
        </Stack>
      </SettingsSection>

      <SettingsSection
        id="maintenance-logs"
        title="Logs"
        description="Tail a redacted diagnostic source without exposing stored secrets."
      >
        <Stack gap="sm">
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-3 sm:grid-cols-[minmax(0,1fr)_7rem_auto]">
            <Select
              label="Source"
              value={selectedLog}
              onChange={(value) => value && setSelectedLog(value)}
              data={logOptions}
              leftSection={<FileClock className="h-4 w-4" />}
              className="col-span-2 min-w-0 sm:col-span-1"
            />
            <NumberInput
              label="Tail"
              value={tailLines}
              onChange={(value) => setTailLines(typeof value === 'number' ? value : 200)}
              min={1}
              max={500}
              className="w-full"
            />
            <UiAction
              variant="secondary"
              type="button"
              leftSection={<RefreshCcw className="h-4 w-4" />}
              onClick={() => logQuery.refetch()}
            >
              Tail
            </UiAction>
          </div>
          <Textarea
            aria-label="Redacted log tail"
            value={logQuery.data?.lines.join('\n') ?? ''}
            minRows={8}
            readOnly
            styles={{ input: { fontFamily: 'var(--mantine-font-family-monospace)' } }}
          />
        </Stack>
      </SettingsSection>

      <SettingsSection
        id="maintenance-backup"
        title="Backup and Restore"
        description="Export or import SQLite data through explicit source and destination paths."
        tone="advanced"
      >
        <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
          <Stack gap="xs">
            <TextInput
              label="SQLite path"
              value={sqlitePath}
              onChange={(event) => setSqlitePath(event.currentTarget.value)}
              placeholder="/path/to/veritas.db"
            />
            <TextInput
              label="Output directory"
              value={outputDir}
              onChange={(event) => setOutputDir(event.currentTarget.value)}
              placeholder="/path/to/export"
            />
            <TextInput
              label="Workspace scope"
              value={workspaceId}
              onChange={(event) => setWorkspaceId(event.currentTarget.value)}
              placeholder="Optional workspace ID"
            />
            <UiAction
              variant="primary"
              type="button"
              leftSection={<Database className="h-4 w-4" />}
              loading={exportSqlite.isPending}
              disabled={!sqlitePath || !outputDir}
              onClick={() =>
                exportSqlite.mutate({
                  sqlitePath,
                  outputDir,
                  workspaceId: workspaceId || undefined,
                })
              }
            >
              Export Backup
            </UiAction>
          </Stack>
          <Stack gap="xs">
            <TextInput
              label="Bundle directory"
              value={bundleDir}
              onChange={(event) => setBundleDir(event.currentTarget.value)}
              placeholder="/path/to/backup-bundle"
            />
            <Checkbox
              label="Replace existing SQLite rows"
              checked={replaceExisting}
              onChange={(event) => setReplaceExisting(event.currentTarget.checked)}
            />
            <UiAction
              variant="secondary"
              type="button"
              leftSection={<Wrench className="h-4 w-4" />}
              loading={importSqlite.isPending}
              disabled={!sqlitePath || !bundleDir}
              onClick={() =>
                importSqlite.mutate({
                  sqlitePath,
                  bundleDir,
                  replaceExisting,
                })
              }
            >
              Import Backup
            </UiAction>
            {lastBackupResult && <Code block>{lastBackupResult}</Code>}
          </Stack>
        </SimpleGrid>
      </SettingsSection>

      <SettingsSection
        id="maintenance-lifecycle"
        title="Lifecycle Policy"
        description="Review retention classes and the kinds of sensitive data each class contains."
      >
        <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="xs">
          {summary.lifecycle.map((entry) => (
            <SettingsGroup key={entry.id}>
              <Group justify="space-between" align="flex-start">
                <div>
                  <Text size="sm" fw={600}>
                    {entry.label}
                  </Text>
                  <Text size="xs" c="dimmed">
                    {entry.rowCount} rows
                  </Text>
                </div>
                <Group gap={4}>
                  {entry.containsSecrets && (
                    <UiPill kind="status" tone="error">
                      Secrets
                    </UiPill>
                  )}
                  {entry.containsPrivatePaths && (
                    <UiPill kind="status" tone="warning">
                      Paths
                    </UiPill>
                  )}
                  {entry.containsGeneratedContent && (
                    <UiPill kind="status" tone="info">
                      Generated
                    </UiPill>
                  )}
                </Group>
              </Group>
            </SettingsGroup>
          ))}
        </SimpleGrid>
      </SettingsSection>

      <Modal
        variant="form"
        compound
        opened={cleanupOpen}
        onClose={() => setCleanupOpen(false)}
        title="Review cleanup"
        centered
      >
        <Stack gap="1rem" className="vk-overlay-scroll">
          <CleanupPreviewList items={summary.cleanupPreview.items} />
          <Text size="xs" c="dimmed">
            {summary.cleanupPreview.notes.join(' ')}
          </Text>
          <TextInput
            label="Confirmation"
            value={cleanupConfirm}
            onChange={(event) => setCleanupConfirm(event.currentTarget.value)}
            placeholder="Type DELETE"
          />
        </Stack>
        <OverlayFooter>
          <UiAction data-autofocus variant="quiet" onClick={() => setCleanupOpen(false)}>
            Close
          </UiAction>
          <UiAction variant="destructive" disabled={!cleanupEnabled}>
            Delete Previewed Items
          </UiAction>
        </OverlayFooter>
      </Modal>
    </SettingsPage>
  );
}
