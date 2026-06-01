import { memo } from 'react';
import { Switch } from '@mantine/core';
import { SettingRow } from './SettingRow';

export const ToggleRow = memo(function ToggleRow({
  label,
  description,
  checked,
  onCheckedChange,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
}) {
  const id = `toggle-${label.toLowerCase().replace(/\s+/g, '-')}`;
  return (
    <SettingRow label={label} description={description}>
      <Switch
        id={id}
        checked={checked}
        onChange={(event) => onCheckedChange(event.currentTarget.checked)}
        aria-label={label}
      />
    </SettingRow>
  );
});
