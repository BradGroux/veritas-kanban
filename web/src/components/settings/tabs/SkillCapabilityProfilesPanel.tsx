import {
  ActionIcon,
  Badge,
  Button,
  Group,
  Loader,
  Paper,
  Stack,
  Table,
  Text,
  Tooltip,
} from '@mantine/core';
import { AlertTriangle, ClipboardList, RefreshCw, ShieldCheck } from 'lucide-react';
import type {
  SkillCapabilityId,
  SkillCapabilityProfile,
  SkillCapabilityRisk,
  SkillCapabilityStatus,
} from '@veritas-kanban/shared';
import {
  useCreateSkillCapabilityRemediationTask,
  useSkillCapabilityProfiles,
} from '@/hooks/useSkillCapabilities';
import { useToast } from '@/hooks/useToast';

const STATUS_COLORS: Record<SkillCapabilityStatus, string> = {
  aligned: 'green',
  mismatch: 'yellow',
  'missing-declaration': 'orange',
};

const SEVERITY_COLORS: Record<SkillCapabilityRisk, string> = {
  low: 'gray',
  medium: 'yellow',
  high: 'orange',
  critical: 'red',
};

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
      {values.slice(0, 4).map((value) => (
        <Badge key={value} size="xs" variant="light" color="blue">
          {value}
        </Badge>
      ))}
      {values.length > 4 && (
        <Badge size="xs" variant="light" color="gray">
          +{values.length - 4}
        </Badge>
      )}
    </Group>
  );
}

function profileObservedCapabilities(profile: SkillCapabilityProfile): SkillCapabilityId[] {
  return profile.observedCapabilities.map((observation) => observation.capability);
}

export function SkillCapabilityProfilesPanel() {
  const { toast } = useToast();
  const profilesQuery = useSkillCapabilityProfiles();
  const createTask = useCreateSkillCapabilityRemediationTask();
  const profiles = profilesQuery.data ?? [];

  const handleCreateTask = (profile: SkillCapabilityProfile) => {
    createTask.mutate(
      { skillId: profile.skillId },
      {
        onSuccess: (result) => {
          toast({
            title: 'Remediation task created',
            description: result.task.title,
          });
        },
        onError: (error) => {
          toast({
            title: 'Failed to create remediation task',
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
            <ShieldCheck className="h-4 w-4 text-muted-foreground" />
            <Text fw={600}>Skill Capability Profiles</Text>
            <Badge color="gray" variant="light">
              {profiles.length}
            </Badge>
          </Group>
          <Tooltip label="Refresh profiles">
            <ActionIcon
              variant="subtle"
              color="gray"
              aria-label="Refresh skill capability profiles"
              onClick={() => profilesQuery.refetch()}
            >
              {profilesQuery.isFetching ? <Loader size="xs" /> : <RefreshCw className="h-4 w-4" />}
            </ActionIcon>
          </Tooltip>
        </Group>

        {profilesQuery.isLoading ? (
          <Group gap="xs">
            <Loader size="sm" />
            <Text size="sm" c="dimmed">
              Loading profiles...
            </Text>
          </Group>
        ) : profiles.length === 0 ? (
          <Text size="sm" c="dimmed">
            No shared skill resources found.
          </Text>
        ) : (
          <Table striped highlightOnHover withTableBorder>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Skill</Table.Th>
                <Table.Th>Status</Table.Th>
                <Table.Th>Severity</Table.Th>
                <Table.Th>Declared</Table.Th>
                <Table.Th>Observed</Table.Th>
                <Table.Th>Findings</Table.Th>
                <Table.Th>Action</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {profiles.map((profile) => (
                <Table.Tr key={profile.skillId}>
                  <Table.Td>
                    <Text size="sm" fw={600}>
                      {profile.name}
                    </Text>
                    <Text size="xs" c="dimmed">
                      v{profile.version} · {profile.skillId}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Badge color={STATUS_COLORS[profile.status]} variant="light">
                      {profile.status}
                    </Badge>
                  </Table.Td>
                  <Table.Td>
                    <Badge color={SEVERITY_COLORS[profile.severity]} variant="light">
                      {profile.severity}
                    </Badge>
                  </Table.Td>
                  <Table.Td>
                    <CapabilityBadges values={profile.declaredCapabilities} />
                  </Table.Td>
                  <Table.Td>
                    <CapabilityBadges values={profileObservedCapabilities(profile)} />
                  </Table.Td>
                  <Table.Td>
                    <Group gap={4}>
                      {profile.findings.length > 0 && (
                        <AlertTriangle className="h-4 w-4 text-amber-500" />
                      )}
                      <Text size="sm">{profile.findings.length}</Text>
                    </Group>
                  </Table.Td>
                  <Table.Td>
                    <Button
                      size="xs"
                      variant="light"
                      leftSection={<ClipboardList className="h-3.5 w-3.5" />}
                      disabled={profile.findings.length === 0 || createTask.isPending}
                      onClick={() => handleCreateTask(profile)}
                    >
                      Create task
                    </Button>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        )}
      </Stack>
    </Paper>
  );
}
