import { Group, Paper, Select, Stack, Text, Textarea } from '@mantine/core';
import { Ban, MessageSquare, Wrench, Link2, HelpCircle } from 'lucide-react';
import type { Task, BlockedCategory, BlockedReason } from '@veritas-kanban/shared';
import { sanitizeText } from '@/lib/sanitize';
import type { ReactNode } from 'react';

interface BlockedReasonSectionProps {
  task: Task;
  onUpdate: (blockedReason: BlockedReason | undefined) => void;
  readOnly?: boolean;
}

const BLOCKED_CATEGORIES: {
  value: BlockedCategory;
  label: string;
  icon: ReactNode;
  description: string;
}[] = [
  {
    value: 'waiting-on-feedback',
    label: 'Waiting on Feedback',
    icon: <MessageSquare className="h-4 w-4" />,
    description: 'Blocked waiting for input from someone',
  },
  {
    value: 'technical-snag',
    label: 'Technical Snag',
    icon: <Wrench className="h-4 w-4" />,
    description: 'Blocked by a technical issue or bug',
  },
  {
    value: 'prerequisite',
    label: 'Prerequisite',
    icon: <Link2 className="h-4 w-4" />,
    description: 'Blocked by another task that must complete first',
  },
  {
    value: 'other',
    label: 'Other',
    icon: <HelpCircle className="h-4 w-4" />,
    description: 'Blocked for another reason',
  },
];

export function BlockedReasonSection({
  task,
  onUpdate,
  readOnly = false,
}: BlockedReasonSectionProps) {
  // Only show when status is blocked
  if (task.status !== 'blocked') {
    return null;
  }

  const currentCategory = task.blockedReason?.category;
  const currentNote = task.blockedReason?.note || '';

  const handleCategoryChange = (value: BlockedCategory) => {
    onUpdate({
      category: value,
      note: currentNote || undefined,
    });
  };

  const handleNoteChange = (note: string) => {
    if (!currentCategory) {
      // If no category selected, default to 'other'
      onUpdate({
        category: 'other',
        note: note || undefined,
      });
    } else {
      onUpdate({
        category: currentCategory,
        note: note || undefined,
      });
    }
  };

  const getCategoryInfo = (category: BlockedCategory) => {
    return BLOCKED_CATEGORIES.find((c) => c.value === category);
  };

  return (
    <Stack gap="sm">
      <Group gap="xs">
        <Ban className="h-4 w-4 text-red-500" />
        <Text size="sm" c="dimmed" fw={500}>
          Blocked Reason
        </Text>
      </Group>

      {readOnly ? (
        <Paper className="space-y-2 border border-red-500/20 bg-red-500/10 p-3" radius="md">
          {currentCategory ? (
            <>
              <Group gap="xs" className="text-red-400">
                {getCategoryInfo(currentCategory)?.icon}
                <Text size="sm" fw={500}>
                  {getCategoryInfo(currentCategory)?.label}
                </Text>
              </Group>
              {currentNote && (
                <Text size="sm" c="dimmed">
                  {sanitizeText(currentNote)}
                </Text>
              )}
            </>
          ) : (
            <Text size="sm" c="dimmed">
              No reason specified
            </Text>
          )}
        </Paper>
      ) : (
        <>
          <Select
            aria-label="Blocked category"
            allowDeselect={false}
            data={BLOCKED_CATEGORIES.map((cat) => ({ value: cat.value, label: cat.label }))}
            placeholder="Why is this task blocked?"
            value={currentCategory ?? null}
            onChange={(value) => {
              if (value) handleCategoryChange(value as BlockedCategory);
            }}
            renderOption={({ option }) => {
              const category = BLOCKED_CATEGORIES.find((cat) => cat.value === option.value);
              if (!category) return option.label;
              return (
                <Group gap="xs">
                  {category.icon}
                  <Text size="sm">{category.label}</Text>
                </Group>
              );
            }}
          />

          <Textarea
            value={currentNote}
            onChange={(e) => handleNoteChange(e.currentTarget.value)}
            placeholder="Add details about what's blocking this task..."
            rows={2}
            className="resize-none text-sm"
          />

          {currentCategory && (
            <Text size="xs" c="dimmed">
              {getCategoryInfo(currentCategory)?.description}
            </Text>
          )}
        </>
      )}
    </Stack>
  );
}

export { BLOCKED_CATEGORIES };
