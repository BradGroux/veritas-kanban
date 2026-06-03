import { useEffect, useMemo, useState } from 'react';
import type { ElementType } from 'react';
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  Code,
  Group,
  Loader,
  Modal,
  NumberInput,
  Paper,
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
    <Paper withBorder radius="md" p="sm">
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
    </Paper>
  );
}

function HealthCheckList({ checks }: { checks: MaintenanceHealthCheck[] }) {
  return (
    <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="xs">
      {checks.map((check) => (
        <Paper key={check.id} withBorder radius="md" p="sm">
          <Group justify="space-between" gap="sm">
            <Text size="sm" fw={600}>
              {check.label}
            </Text>
            <Badge color={HEALTH_COLORS[check.state]} variant="light">
              {check.state}
            </Badge>
          </Group>
          <Text size="xs" c="dimmed" mt={4}>
            {check.detail}
          </Text>
        </Paper>
      ))}
    </SimpleGrid>
  );
}

function StorageTable({ categories }: { categories: MaintenanceStorageCategory[] }) {
  return (
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
              <Badge color={category.cleanupEligibleCount > 0 ? 'yellow' : 'gray'} variant="light">
                {category.cleanupEligibleCount}
              </Badge>
            </Table.Td>
            <Table.Td>{formatDate(category.lastUsedAt)}</Table.Td>
          </Table.Tr>
        ))}
      </Table.Tbody>
    </Table>
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
        <Paper key={item.id} withBorder radius="md" p="sm">
          <Group justify="space-between" align="flex-start" gap="sm">
            <div>
              <Group gap="xs">
                <Text size="sm" fw={600}>
                  {item.label}
                </Text>
                <Badge color={item.cleanupEligible ? 'yellow' : 'gray'} variant="light">
                  {item.category}
                </Badge>
              </Group>
              <Text size="xs" c="dimmed">
                {item.retainedReason}
              </Text>
            </div>
            <Text size="sm" fw={600}>
              {formatBytes(item.estimatedBytes)}
            </Text>
          </Group>
        </Paper>
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
      <Alert color="red" title="Maintenance unavailable">
        {summaryQuery.error instanceof Error ? summaryQuery.error.message : 'Failed to load state'}
      </Alert>
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
    <Stack gap="lg">
      <Group justify="space-between" align="flex-start">
        <div>
          <Text size="sm" fw={700}>
            Maintenance Center
          </Text>
          <Text size="xs" c="dimmed">
            {summary.storageMode} storage, {summary.mode} mode, refreshed{' '}
            {formatDate(summary.generatedAt)}
          </Text>
        </div>
        <Group gap="xs">
          <Tooltip label="Refresh maintenance state">
            <Button
              type="button"
              size="xs"
              variant="light"
              leftSection={<RefreshCcw className="h-4 w-4" />}
              onClick={() => summaryQuery.refetch()}
            >
              Refresh
            </Button>
          </Tooltip>
          <Button
            type="button"
            size="xs"
            leftSection={<FileArchive className="h-4 w-4" />}
            loading={debugBundle.isPending}
            onClick={() => debugBundle.mutate()}
          >
            Debug Bundle
          </Button>
        </Group>
      </Group>

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

      <section className="space-y-3">
        <Text size="sm" fw={700}>
          Health
        </Text>
        <HealthCheckList checks={summary.health} />
      </section>

      <section className="space-y-3">
        <Group justify="space-between">
          <Text size="sm" fw={700}>
            Storage Usage
          </Text>
          <Badge variant="light">{formatBytes(summary.storage.totalBytes)}</Badge>
        </Group>
        <StorageTable categories={summary.storage.categories} />
      </section>

      <section className="space-y-3">
        <Group justify="space-between">
          <div>
            <Text size="sm" fw={700}>
              Cleanup Preview
            </Text>
            <Text size="xs" c="dimmed">
              {formatBytes(cleanupBytes)} across {summary.cleanupPreview.items.length} previewed
              items
            </Text>
          </div>
          <Button
            type="button"
            size="xs"
            color="red"
            variant="outline"
            leftSection={<Trash2 className="h-4 w-4" />}
            onClick={() => setCleanupOpen(true)}
          >
            Review Cleanup
          </Button>
        </Group>
        <CleanupPreviewList items={summary.cleanupPreview.items} />
        <Progress
          value={workProductRatio}
          size="sm"
          color="yellow"
          aria-label="Work product cleanup ratio"
        />
      </section>

      <section className="space-y-3">
        <Text size="sm" fw={700}>
          Logs
        </Text>
        <Group align="flex-end" gap="sm">
          <Select
            label="Source"
            value={selectedLog}
            onChange={(value) => value && setSelectedLog(value)}
            data={logOptions}
            leftSection={<FileClock className="h-4 w-4" />}
            className="flex-1"
          />
          <NumberInput
            label="Tail"
            value={tailLines}
            onChange={(value) => setTailLines(typeof value === 'number' ? value : 200)}
            min={1}
            max={500}
            w={120}
          />
          <Button
            type="button"
            variant="light"
            leftSection={<RefreshCcw className="h-4 w-4" />}
            onClick={() => logQuery.refetch()}
          >
            Tail
          </Button>
        </Group>
        <Textarea
          aria-label="Redacted log tail"
          value={logQuery.data?.lines.join('\n') ?? ''}
          minRows={8}
          readOnly
          styles={{ input: { fontFamily: 'var(--mantine-font-family-monospace)' } }}
        />
      </section>

      <section className="space-y-3">
        <Text size="sm" fw={700}>
          Backup and Restore
        </Text>
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
            <Button
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
            </Button>
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
            <Button
              type="button"
              variant="outline"
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
            </Button>
            {lastBackupResult && <Code block>{lastBackupResult}</Code>}
          </Stack>
        </SimpleGrid>
      </section>

      <section className="space-y-3">
        <Text size="sm" fw={700}>
          Lifecycle Policy
        </Text>
        <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="xs">
          {summary.lifecycle.map((entry) => (
            <Paper key={entry.id} withBorder radius="md" p="sm">
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
                  {entry.containsSecrets && <Badge color="red">Secrets</Badge>}
                  {entry.containsPrivatePaths && <Badge color="yellow">Paths</Badge>}
                  {entry.containsGeneratedContent && <Badge color="blue">Generated</Badge>}
                </Group>
              </Group>
            </Paper>
          ))}
        </SimpleGrid>
      </section>

      <Modal
        opened={cleanupOpen}
        onClose={() => setCleanupOpen(false)}
        title="Review cleanup"
        centered
      >
        <Stack gap="md">
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
          <Group justify="flex-end">
            <Button variant="subtle" color="gray" onClick={() => setCleanupOpen(false)}>
              Close
            </Button>
            <Button color="red" disabled={!cleanupEnabled}>
              Delete Previewed Items
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}
