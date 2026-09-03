import { memo } from 'react';
import type { ReactNode } from 'react';
import { Stack, Text } from '@mantine/core';

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
    <div
      className="grid gap-3 py-3 sm:grid-cols-[minmax(0,1fr)_minmax(10rem,14rem)] sm:items-center"
      data-settings-row
    >
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
      <div
        className="flex min-w-0 w-full sm:justify-end [&_.mantine-InputWrapper-root]:w-full [&_.mantine-Select-root]:w-full"
        data-settings-control
      >
        {children}
      </div>
    </div>
  );
});
