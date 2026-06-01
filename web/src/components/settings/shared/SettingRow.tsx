import { memo } from 'react';
import type { ReactNode } from 'react';
import { Group, Stack, Text } from '@mantine/core';

export const SettingRow = memo(function SettingRow({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <Group justify="space-between" align="center" gap="md" py="sm" wrap="nowrap">
      <Stack gap={2} className="min-w-0 flex-1">
        <Text size="sm" fw={500}>
          {label}
        </Text>
        {description && (
          <Text size="xs" c="dimmed">
            {description}
          </Text>
        )}
      </Stack>
      <div className="flex-shrink-0">{children}</div>
    </Group>
  );
});
