import { useState } from 'react';
import { FileText, Pencil, Trash2, X, Check, Plus, ExternalLink } from 'lucide-react';
import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Group,
  Modal,
  Paper,
  Select,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  Textarea,
  ThemeIcon,
} from '@mantine/core';
import {
  useAddDeliverable,
  useUpdateDeliverable,
  useDeleteDeliverable,
} from '@/hooks/useDeliverables';
import type { Task, Deliverable, DeliverableType, DeliverableStatus } from '@veritas-kanban/shared';

interface DeliverablesSectionProps {
  task: Task;
}

const TYPE_COLORS: Record<DeliverableType, string> = {
  document: 'blue',
  code: 'violet',
  report: 'green',
  artifact: 'orange',
  other: 'gray',
};

const STATUS_COLORS: Record<DeliverableStatus, string> = {
  pending: 'yellow',
  attached: 'blue',
  reviewed: 'violet',
  accepted: 'green',
};

const DELIVERABLE_TYPES: { value: DeliverableType; label: string }[] = [
  { value: 'document', label: 'Document' },
  { value: 'code', label: 'Code' },
  { value: 'report', label: 'Report' },
  { value: 'artifact', label: 'Artifact' },
  { value: 'other', label: 'Other' },
];

const DELIVERABLE_STATUSES: { value: DeliverableStatus; label: string }[] = [
  { value: 'pending', label: 'Pending' },
  { value: 'attached', label: 'Attached' },
  { value: 'reviewed', label: 'Reviewed' },
  { value: 'accepted', label: 'Accepted' },
];

function DeliverableItem({ deliverable, taskId }: { deliverable: Deliverable; taskId: string }) {
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(deliverable.title);
  const [editType, setEditType] = useState<DeliverableType>(deliverable.type);
  const [editPath, setEditPath] = useState(deliverable.path || '');
  const [editStatus, setEditStatus] = useState<DeliverableStatus>(deliverable.status);
  const [editDescription, setEditDescription] = useState(deliverable.description || '');
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  const updateDeliverable = useUpdateDeliverable();
  const deleteDeliverable = useDeleteDeliverable();

  const handleSaveEdit = async () => {
    if (!editTitle.trim()) return;
    await updateDeliverable.mutateAsync({
      taskId,
      deliverableId: deliverable.id,
      title: editTitle.trim(),
      type: editType,
      path: editPath.trim() || undefined,
      status: editStatus,
      description: editDescription.trim() || undefined,
    });
    setIsEditing(false);
  };

  const handleCancelEdit = () => {
    setEditTitle(deliverable.title);
    setEditType(deliverable.type);
    setEditPath(deliverable.path || '');
    setEditStatus(deliverable.status);
    setEditDescription(deliverable.description || '');
    setIsEditing(false);
  };

  const handleDelete = async () => {
    await deleteDeliverable.mutateAsync({ taskId, deliverableId: deliverable.id });
    setDeleteDialogOpen(false);
  };

  const isUrl = deliverable.path && /^https?:\/\//i.test(deliverable.path);

  return (
    <>
      <Paper className="group flex gap-3 border border-border/50 bg-muted/30 p-3" radius="md">
        <ThemeIcon variant="light" color="violet" size="lg" radius="md" className="flex-shrink-0">
          <FileText className="h-4 w-4" />
        </ThemeIcon>
        <Box className="min-w-0 flex-1">
          {isEditing ? (
            <Stack gap="sm">
              <Stack gap={4}>
                <Text size="xs" fw={500}>
                  Title
                </Text>
                <TextInput
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.currentTarget.value)}
                  placeholder="Deliverable title"
                  size="xs"
                  autoFocus
                  aria-label="Deliverable title"
                />
              </Stack>
              <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="xs">
                <Stack gap={4}>
                  <Text size="xs" fw={500}>
                    Type
                  </Text>
                  <Select
                    aria-label="Deliverable type"
                    allowDeselect={false}
                    data={DELIVERABLE_TYPES}
                    value={editType}
                    onChange={(value) => {
                      if (value) setEditType(value as DeliverableType);
                    }}
                    size="xs"
                  />
                </Stack>
                <Stack gap={4}>
                  <Text size="xs" fw={500}>
                    Status
                  </Text>
                  <Select
                    aria-label="Deliverable status"
                    allowDeselect={false}
                    data={DELIVERABLE_STATUSES}
                    value={editStatus}
                    onChange={(value) => {
                      if (value) setEditStatus(value as DeliverableStatus);
                    }}
                    size="xs"
                  />
                </Stack>
              </SimpleGrid>
              <Stack gap={4}>
                <Text size="xs" fw={500}>
                  Path / URL (optional)
                </Text>
                <TextInput
                  value={editPath}
                  onChange={(e) => setEditPath(e.currentTarget.value)}
                  placeholder="https://... or /path/to/file"
                  size="xs"
                  aria-label="Deliverable path or URL"
                />
              </Stack>
              <Stack gap={4}>
                <Text size="xs" fw={500}>
                  Description (optional)
                </Text>
                <Textarea
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.currentTarget.value)}
                  placeholder="Add details about this deliverable..."
                  rows={2}
                  className="resize-none"
                  aria-label="Deliverable description"
                />
              </Stack>
              <Group gap="xs">
                <Button
                  size="xs"
                  onClick={() => {
                    void handleSaveEdit();
                  }}
                  disabled={!editTitle.trim() || updateDeliverable.isPending}
                  leftSection={<Check className="h-3 w-3" />}
                >
                  Save
                </Button>
                <Button variant="subtle" size="xs" onClick={handleCancelEdit}>
                  <X className="h-3 w-3" />
                  Cancel
                </Button>
              </Group>
            </Stack>
          ) : (
            <Stack gap={6}>
              <Group align="flex-start" gap="xs" wrap="nowrap">
                <Text size="sm" fw={500} className="min-w-0 flex-1">
                  {deliverable.title}
                </Text>
                <Group gap={4} className="opacity-0 transition-opacity group-hover:opacity-100">
                  <ActionIcon
                    variant="subtle"
                    color="gray"
                    size="sm"
                    aria-label="Edit deliverable"
                    onClick={() => setIsEditing(true)}
                  >
                    <Pencil className="h-3 w-3 text-muted-foreground hover:text-foreground" />
                  </ActionIcon>
                  <ActionIcon
                    variant="subtle"
                    color="red"
                    size="sm"
                    aria-label="Delete deliverable"
                    onClick={() => setDeleteDialogOpen(true)}
                  >
                    <Trash2 className="h-3 w-3" />
                  </ActionIcon>
                </Group>
              </Group>
              <Group gap="xs">
                <Badge color={TYPE_COLORS[deliverable.type]} variant="light" size="sm">
                  {deliverable.type}
                </Badge>
                <Badge color={STATUS_COLORS[deliverable.status]} variant="light" size="sm">
                  {deliverable.status}
                </Badge>
                {deliverable.agent && (
                  <Text size="xs" c="dimmed">
                    by {deliverable.agent}
                  </Text>
                )}
              </Group>
              {deliverable.path && (
                <Group gap={4} className="min-w-0">
                  {isUrl ? (
                    <Text
                      component="a"
                      href={deliverable.path}
                      target="_blank"
                      rel="noopener noreferrer"
                      size="xs"
                      className="flex min-w-0 items-center gap-1 text-primary hover:underline"
                    >
                      <span className="truncate">{deliverable.path}</span>
                      <ExternalLink className="h-3 w-3 flex-shrink-0" />
                    </Text>
                  ) : (
                    <Text size="xs" c="dimmed" ff="monospace" className="truncate">
                      {deliverable.path}
                    </Text>
                  )}
                </Group>
              )}
              {deliverable.description && (
                <Text size="xs" className="text-foreground/70">
                  {deliverable.description}
                </Text>
              )}
              <Text size="xs" c="dimmed">
                Added {new Date(deliverable.created).toLocaleDateString()}
              </Text>
            </Stack>
          )}
        </Box>
      </Paper>

      <Modal
        opened={deleteDialogOpen}
        onClose={() => setDeleteDialogOpen(false)}
        title="Delete deliverable?"
        centered
      >
        <Stack gap="md">
          <Text size="sm">Remove "{deliverable.title}" from this task's deliverables?</Text>
          <Group justify="flex-end" gap="sm">
            <Button variant="default" onClick={() => setDeleteDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              color="red"
              onClick={() => {
                void handleDelete();
              }}
            >
              Delete
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  );
}

export function DeliverablesSection({ task }: DeliverablesSectionProps) {
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState('');
  const [type, setType] = useState<DeliverableType>('document');
  const [path, setPath] = useState('');
  const [description, setDescription] = useState('');

  const addDeliverable = useAddDeliverable();

  const deliverables = task.deliverables || [];

  const handleAddDeliverable = async () => {
    if (!title.trim()) return;
    await addDeliverable.mutateAsync({
      taskId: task.id,
      title: title.trim(),
      type,
      path: path.trim() || undefined,
      description: description.trim() || undefined,
    });
    setTitle('');
    setType('document');
    setPath('');
    setDescription('');
    setShowForm(false);
  };

  const handleCancel = () => {
    setTitle('');
    setType('document');
    setPath('');
    setDescription('');
    setShowForm(false);
  };

  return (
    <Stack gap="sm">
      <Group justify="space-between" align="center">
        <Group gap="xs">
          <FileText className="h-4 w-4 text-muted-foreground" />
          <Text size="sm" fw={500}>
            Deliverables {deliverables.length > 0 && `(${deliverables.length})`}
          </Text>
        </Group>
        {!showForm && (
          <Button
            variant="outline"
            size="xs"
            onClick={() => setShowForm(true)}
            leftSection={<Plus className="h-3 w-3" />}
          >
            Add
          </Button>
        )}
      </Group>

      {deliverables.length === 0 && !showForm && (
        <Text size="sm" c="dimmed">
          No deliverables yet
        </Text>
      )}

      {showForm && (
        <Paper className="border border-border bg-muted/20 p-3" radius="md">
          <Stack gap="sm">
            <Stack gap={4}>
              <Text size="xs" fw={500}>
                Title *
              </Text>
              <TextInput
                value={title}
                onChange={(e) => setTitle(e.currentTarget.value)}
                placeholder="e.g., API Documentation"
                size="xs"
                autoFocus
                aria-label="New deliverable title"
              />
            </Stack>
            <Stack gap={4}>
              <Text size="xs" fw={500}>
                Type *
              </Text>
              <Select
                aria-label="New deliverable type"
                allowDeselect={false}
                data={DELIVERABLE_TYPES}
                value={type}
                onChange={(value) => {
                  if (value) setType(value as DeliverableType);
                }}
                size="xs"
              />
            </Stack>
            <Stack gap={4}>
              <Text size="xs" fw={500}>
                Path / URL (optional)
              </Text>
              <TextInput
                value={path}
                onChange={(e) => setPath(e.currentTarget.value)}
                placeholder="https://... or /path/to/file"
                size="xs"
                aria-label="New deliverable path or URL"
              />
            </Stack>
            <Stack gap={4}>
              <Text size="xs" fw={500}>
                Description (optional)
              </Text>
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.currentTarget.value)}
                placeholder="Add details about this deliverable..."
                rows={2}
                className="resize-none"
                aria-label="New deliverable description"
              />
            </Stack>
            <Group gap="xs">
              <Button
                size="sm"
                onClick={() => {
                  void handleAddDeliverable();
                }}
                disabled={!title.trim() || addDeliverable.isPending}
                leftSection={<Check className="h-3 w-3" />}
              >
                Add Deliverable
              </Button>
              <Button variant="subtle" size="sm" onClick={handleCancel}>
                <X className="h-3 w-3" />
                Cancel
              </Button>
            </Group>
          </Stack>
        </Paper>
      )}

      <Stack gap="xs">
        {deliverables.map((deliverable) => (
          <DeliverableItem key={deliverable.id} deliverable={deliverable} taskId={task.id} />
        ))}
      </Stack>
    </Stack>
  );
}
