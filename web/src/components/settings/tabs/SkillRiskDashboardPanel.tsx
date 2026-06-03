import { useMemo, useState } from 'react';
import {
  ActionIcon,
  Badge,
  Button,
  Group,
  Loader,
  Modal,
  Paper,
  SimpleGrid,
  Stack,
  Table,
  Text,
  TextInput,
  Textarea,
  Tooltip,
} from '@mantine/core';
import { AlertTriangle, ClipboardList, RefreshCw, ShieldAlert } from 'lucide-react';
import type {
  SkillCapabilityId,
  SkillRiskInventoryItem,
  SkillSecurityDecision,
  SkillSecuritySeverity,
} from '@veritas-kanban/shared';
import {
  useCreateSkillRiskRemediationTask,
  useCreateSkillSecurityException,
  useSkillRiskInventory,
} from '@/hooks/useSkillSecurity';
import { useToast } from '@/hooks/useToast';

const SEVERITY_COLORS: Record<SkillSecuritySeverity, string> = {
  low: 'gray',
  medium: 'yellow',
  high: 'orange',
  critical: 'red',
};

const DECISION_COLORS: Record<SkillSecurityDecision, string> = {
  allow: 'green',
  warn: 'yellow',
  block: 'red',
};

function formatDate(value?: string): string {
  if (!value) return 'never';
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value));
}

function defaultExpiration(): string {
  const date = new Date();
  date.setDate(date.getDate() + 14);
  return date.toISOString().slice(0, 16);
}

function toIsoDateTime(value: string): string {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : value;
}

function CapabilityBadges({ values }: { values: SkillCapabilityId[] }) {
  if (values.length === 0) {
    return (
      <Text size="xs" c="dimmed">
        none
      </Text>
    );
  }
  return (
    <Group gap={4}>
      {values.slice(0, 3).map((value) => (
        <Badge key={value} size="xs" variant="light" color="blue">
          {value}
        </Badge>
      ))}
      {values.length > 3 && (
        <Badge size="xs" variant="light" color="gray">
          +{values.length - 3}
        </Badge>
      )}
    </Group>
  );
}

function observedCapabilities(item: SkillRiskInventoryItem): SkillCapabilityId[] {
  return item.observedCapabilities.map((observation) => observation.capability);
}

export function SkillRiskDashboardPanel() {
  const { toast } = useToast();
  const inventoryQuery = useSkillRiskInventory();
  const createTask = useCreateSkillRiskRemediationTask();
  const createException = useCreateSkillSecurityException();
  const inventory = inventoryQuery.data;
  const [exceptionSkill, setExceptionSkill] = useState<SkillRiskInventoryItem | null>(null);
  const [exceptionOwner, setExceptionOwner] = useState('');
  const [exceptionReason, setExceptionReason] = useState('');
  const [exceptionExpiresAt, setExceptionExpiresAt] = useState(defaultExpiration);

  const sortedItems = useMemo(
    () =>
      [...(inventory?.items ?? [])].sort((a, b) => {
        if (a.installDecision !== b.installDecision) {
          const rank: Record<SkillSecurityDecision, number> = { block: 3, warn: 2, allow: 1 };
          return rank[b.installDecision] - rank[a.installDecision];
        }
        return b.riskScore - a.riskScore;
      }),
    [inventory?.items]
  );

  const openException = (item: SkillRiskInventoryItem) => {
    setExceptionSkill(item);
    setExceptionOwner(item.exception?.owner ?? '');
    setExceptionReason(item.exception?.reason ?? '');
    setExceptionExpiresAt(item.exception?.expiresAt?.slice(0, 16) ?? defaultExpiration());
  };

  const handleCreateTask = (item: SkillRiskInventoryItem) => {
    createTask.mutate(
      { skillId: item.skillId },
      {
        onSuccess: (result) => {
          toast({ title: 'Skill risk task created', description: result.task.title });
        },
        onError: (error) => {
          toast({
            title: 'Failed to create skill risk task',
            description: error instanceof Error ? error.message : 'Unknown error',
            variant: 'destructive',
            duration: Infinity,
          });
        },
      }
    );
  };

  const handleCreateException = () => {
    if (!exceptionSkill) return;
    createException.mutate(
      {
        skillId: exceptionSkill.skillId,
        input: {
          owner: exceptionOwner,
          reason: exceptionReason,
          expiresAt: toIsoDateTime(exceptionExpiresAt),
        },
      },
      {
        onSuccess: () => {
          toast({ title: 'Skill exception recorded', description: exceptionSkill.name });
          setExceptionSkill(null);
        },
        onError: (error) => {
          toast({
            title: 'Failed to record skill exception',
            description: error instanceof Error ? error.message : 'Unknown error',
            variant: 'destructive',
            duration: Infinity,
          });
        },
      }
    );
  };

  return (
    <Paper withBorder radius="md" p="md">
      <Stack gap="md">
        <Group justify="space-between" gap="sm">
          <Group gap="xs">
            <ShieldAlert className="h-4 w-4 text-muted-foreground" />
            <Text fw={600}>Skill Risk Dashboard</Text>
            <Badge color={inventory?.totals.blocked ? 'red' : 'green'} variant="light">
              {inventory?.totals.blocked ?? 0} blocked
            </Badge>
          </Group>
          <Tooltip label="Refresh skill risk inventory">
            <ActionIcon
              variant="subtle"
              color="gray"
              aria-label="Refresh skill risk inventory"
              onClick={() => inventoryQuery.refetch()}
            >
              {inventoryQuery.isFetching ? <Loader size="xs" /> : <RefreshCw className="h-4 w-4" />}
            </ActionIcon>
          </Tooltip>
        </Group>

        {inventoryQuery.isLoading ? (
          <Group gap="xs">
            <Loader size="sm" />
            <Text size="sm" c="dimmed">
              Loading skill risk inventory...
            </Text>
          </Group>
        ) : !inventory || sortedItems.length === 0 ? (
          <Text size="sm" c="dimmed">
            No shared skill resources found.
          </Text>
        ) : (
          <>
            <SimpleGrid cols={{ base: 2, md: 5 }} spacing="xs">
              <Badge variant="light" color="gray">
                {inventory.totals.skills} skills
              </Badge>
              <Badge variant="light" color="red">
                {inventory.totals.blocked} blocked
              </Badge>
              <Badge variant="light" color="yellow">
                {inventory.totals.warnings} warnings
              </Badge>
              <Badge variant="light" color="orange">
                {inventory.totals.unscanned} unscanned
              </Badge>
              <Badge variant="light" color="blue">
                {inventory.totals.exceptions} exceptions
              </Badge>
            </SimpleGrid>

            <Table striped highlightOnHover withTableBorder>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Skill</Table.Th>
                  <Table.Th>Scan</Table.Th>
                  <Table.Th>Risk</Table.Th>
                  <Table.Th>Capabilities</Table.Th>
                  <Table.Th>Install gate</Table.Th>
                  <Table.Th>Action</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {sortedItems.map((item) => (
                  <Table.Tr key={item.skillId}>
                    <Table.Td>
                      <Text size="sm" fw={600}>
                        {item.name}
                      </Text>
                      <Text size="xs" c="dimmed">
                        v{item.version} · {item.sourcePath}
                      </Text>
                      {item.remediationTaskId && (
                        <Badge size="xs" color="blue" variant="light">
                          task {item.remediationTaskId}
                        </Badge>
                      )}
                    </Table.Td>
                    <Table.Td>
                      <Group gap={4}>
                        <Badge
                          color={item.scanStatus === 'scanned' ? 'green' : 'orange'}
                          variant="light"
                        >
                          {item.scanStatus}
                        </Badge>
                        {item.changedFiles.length > 0 && (
                          <Badge color="yellow" variant="light" size="xs">
                            changed
                          </Badge>
                        )}
                      </Group>
                      <Text size="xs" c="dimmed">
                        {formatDate(item.lastScannedAt)}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Badge color={SEVERITY_COLORS[item.severity]} variant="light">
                        {item.severity}
                      </Badge>
                      <Text size="xs" c="dimmed">
                        score {item.riskScore} · {item.findingCount} findings
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Stack gap={4}>
                        <Group gap={4}>
                          <Text size="xs" c="dimmed">
                            declared
                          </Text>
                          <CapabilityBadges values={item.declaredCapabilities} />
                        </Group>
                        <Group gap={4}>
                          <Text size="xs" c="dimmed">
                            observed
                          </Text>
                          <CapabilityBadges values={observedCapabilities(item)} />
                        </Group>
                      </Stack>
                    </Table.Td>
                    <Table.Td>
                      <Badge color={DECISION_COLORS[item.installDecision]} variant="light">
                        {item.installDecision}
                      </Badge>
                      <Text size="xs" c="dimmed">
                        {item.exception
                          ? `${item.exception.owner} until ${formatDate(item.exception.expiresAt)}`
                          : item.installReason}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Group gap="xs" wrap="nowrap">
                        <Button
                          size="xs"
                          variant="light"
                          leftSection={<ClipboardList className="h-3.5 w-3.5" />}
                          loading={createTask.isPending}
                          onClick={() => handleCreateTask(item)}
                        >
                          Task
                        </Button>
                        <Button
                          size="xs"
                          variant="subtle"
                          color={item.installDecision === 'block' ? 'red' : 'gray'}
                          leftSection={<AlertTriangle className="h-3.5 w-3.5" />}
                          onClick={() => openException(item)}
                        >
                          Exception
                        </Button>
                      </Group>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </>
        )}
      </Stack>

      <Modal
        opened={Boolean(exceptionSkill)}
        onClose={() => setExceptionSkill(null)}
        title={exceptionSkill ? `Exception for ${exceptionSkill.name}` : 'Skill exception'}
      >
        <Stack gap="sm">
          <TextInput
            label="Owner"
            value={exceptionOwner}
            onChange={(event) => setExceptionOwner(event.currentTarget.value)}
            placeholder="security reviewer"
          />
          <TextInput
            label="Expires"
            type="datetime-local"
            value={exceptionExpiresAt}
            onChange={(event) => setExceptionExpiresAt(event.currentTarget.value)}
          />
          <Textarea
            label="Reason"
            value={exceptionReason}
            minRows={3}
            onChange={(event) => setExceptionReason(event.currentTarget.value)}
            placeholder="Why this skill is allowed temporarily"
          />
          <Group justify="flex-end">
            <Button variant="subtle" onClick={() => setExceptionSkill(null)}>
              Cancel
            </Button>
            <Button loading={createException.isPending} onClick={handleCreateException}>
              Save Exception
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Paper>
  );
}
