import { memo } from 'react';
import { Input } from '@/components/ui/input';
import { SettingRow } from './SettingRow';

export const NumberRow = memo(function NumberRow({ label, description, value, onChange, min, max, step, unit }: {
  label: string;
  description?: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
}) {
  return (
    <SettingRow label={label} description={description}>
      <div className="flex items-center gap-2">
        <Input
          type="number"
          value={value}
          onChange={(e) => {
            const v = parseFloat(e.target.value);
            if (!isNaN(v)) {
              const clamped = Math.max(min ?? -Infinity, Math.min(max ?? Infinity, v));
              onChange(clamped);
            }
          }}
          min={min}
          max={max}
          step={step}
          className="w-24 h-8 text-right"
        />
        {unit && <span className="text-xs text-muted-foreground">{unit}</span>}
      </div>
    </SettingRow>
  );
});
