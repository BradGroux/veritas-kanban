import { UiAction, UiHeading } from '@/components/ui/UiVocabulary';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { Group, Modal, Stack, Text } from '@mantine/core';
import { RotateCcw } from 'lucide-react';

export function SectionHeader({
  id,
  title,
  description,
  status,
  actions,
  onReset,
  contained = false,
}: {
  id?: string;
  title: string;
  description?: string;
  status?: ReactNode;
  actions?: ReactNode;
  onReset?: () => void;
  contained?: boolean;
}) {
  const [resetOpen, setResetOpen] = useState(false);

  const handleReset = () => {
    onReset?.();
    setResetOpen(false);
  };

  return (
    <Group
      justify="space-between"
      align="flex-start"
      gap="md"
      wrap="wrap"
      className={contained ? 'mb-2 border-b pb-3' : 'mb-2 border-b pb-2'}
    >
      <div className="min-w-0 flex-1">
        <Group gap="xs" wrap="wrap">
          <UiHeading id={id} order={3}>
            {title}
          </UiHeading>
          {status}
        </Group>
        {description && (
          <Text size="xs" c="dimmed" mt={3}>
            {description}
          </Text>
        )}
      </div>
      {(actions || onReset) && (
        <Group gap="xs">
          {actions}
          {onReset && (
            <>
              <UiAction
                variant="quiet"
                type="button"
                leftSection={<RotateCcw className="h-3 w-3" />}
                onClick={() => setResetOpen(true)}
              >
                Reset
              </UiAction>
              <Modal
                opened={resetOpen}
                onClose={() => setResetOpen(false)}
                title="Reset to defaults?"
                centered
              >
                <Stack gap="md">
                  <Text size="sm" c="dimmed">
                    This will reset all {title.toLowerCase()} settings to their default values.
                  </Text>
                  <Group justify="flex-end">
                    <UiAction variant="quiet" onClick={() => setResetOpen(false)}>
                      Cancel
                    </UiAction>
                    <UiAction variant="primary" onClick={handleReset}>
                      Reset
                    </UiAction>
                  </Group>
                </Stack>
              </Modal>
            </>
          )}
        </Group>
      )}
    </Group>
  );
}
