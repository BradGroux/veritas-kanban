import { memo, useState, useEffect } from 'react';
import { NumberInput } from '@mantine/core';
import { SettingRow } from './SettingRow';

export const NumberRow = memo(function NumberRow({
  label,
  description,
  value,
  onChange,
  min,
  max,
  step,
  unit,
  hideSpinners,
  maxLength,
}: {
  label: string;
  description?: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  hideSpinners?: boolean;
  maxLength?: number;
}) {
  // Use text input with local state - only save on blur
  const [localValue, setLocalValue] = useState(value.toString());

  // Sync local value when external value changes (e.g., reset)
  useEffect(() => {
    setLocalValue(value.toString());
  }, [value]);

  const clamp = (nextValue: number, fallbackMin: number) => {
    return Math.max(min ?? fallbackMin, Math.min(max ?? Infinity, nextValue));
  };

  if (hideSpinners) {
    const handleBlur = () => {
      const raw = localValue.replace(/[^0-9]/g, '');
      if (raw === '') {
        setLocalValue((min ?? 0).toString());
        onChange(min ?? 0);
        return;
      }
      const v = parseInt(raw, 10);
      if (!isNaN(v)) {
        const clamped = clamp(v, 0);
        setLocalValue(clamped.toString());
        onChange(clamped);
      }
    };

    return (
      <SettingRow label={label} description={description}>
        <NumberInput
          aria-label={label}
          type="text"
          inputMode="numeric"
          allowDecimal={false}
          allowNegative={false}
          clampBehavior="blur"
          hideControls
          value={localValue}
          onChange={(nextValue) => {
            const raw = String(nextValue).replace(/[^0-9]/g, '');
            setLocalValue(raw.slice(0, maxLength ?? 10));
          }}
          onBlur={handleBlur}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              handleBlur();
              (e.target as HTMLInputElement).blur();
            }
          }}
          min={min}
          max={max}
          step={step}
          suffix={unit ? ` ${unit}` : undefined}
          valueIsNumericString
          className="w-full"
          styles={{ input: { textAlign: 'right' } }}
        />
      </SettingRow>
    );
  }

  return (
    <SettingRow label={label} description={description}>
      <NumberInput
        aria-label={label}
        value={value}
        onChange={(nextValue) => {
          const v = typeof nextValue === 'number' ? nextValue : parseFloat(nextValue);
          if (!isNaN(v)) {
            onChange(clamp(v, -Infinity));
          }
        }}
        min={min}
        max={max}
        step={step}
        suffix={unit ? ` ${unit}` : undefined}
        className="w-full"
        styles={{ input: { textAlign: 'right' } }}
      />
    </SettingRow>
  );
});
