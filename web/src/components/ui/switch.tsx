'use client';

import * as React from 'react';
import { Switch as MantineSwitch, type SwitchProps as MantineSwitchProps } from '@mantine/core';

import { cn } from '@/lib/utils';

type SwitchProps = Omit<MantineSwitchProps, 'onChange' | 'size' | 'classNames'> & {
  size?: 'sm' | 'default';
  onCheckedChange?: (checked: boolean) => void;
  onChange?: React.ChangeEventHandler<HTMLInputElement>;
};

function Switch({ className, size = 'default', onCheckedChange, onChange, ...props }: SwitchProps) {
  const handleChange = React.useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      onChange?.(event);
      onCheckedChange?.(event.currentTarget.checked);
    },
    [onChange, onCheckedChange]
  );

  return (
    <MantineSwitch
      data-slot="switch"
      data-size={size}
      size={size === 'sm' ? 'xs' : 'sm'}
      onChange={handleChange}
      className={className}
      classNames={{
        root: 'inline-flex',
        track: cn(
          'cursor-pointer border-transparent transition-all focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50'
        ),
      }}
      {...props}
    />
  );
}

export { Switch };
