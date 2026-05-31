import * as React from 'react';
import {
  Checkbox as MantineCheckbox,
  type CheckboxProps as MantineCheckboxProps,
} from '@mantine/core';

import { cn } from '@/lib/utils';

type CheckedState = boolean | 'indeterminate';

type CheckboxProps = Omit<
  MantineCheckboxProps,
  'checked' | 'defaultChecked' | 'onChange' | 'classNames'
> & {
  checked?: CheckedState;
  defaultChecked?: CheckedState;
  onCheckedChange?: (checked: CheckedState) => void;
  onChange?: React.ChangeEventHandler<HTMLInputElement>;
};

function Checkbox({
  className,
  checked,
  defaultChecked,
  onCheckedChange,
  onChange,
  ...props
}: CheckboxProps) {
  const handleChange = React.useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      onChange?.(event);
      onCheckedChange?.(event.currentTarget.checked);
    },
    [onChange, onCheckedChange]
  );

  return (
    <MantineCheckbox
      data-slot="checkbox"
      checked={checked === 'indeterminate' ? false : checked}
      defaultChecked={defaultChecked === 'indeterminate' ? false : defaultChecked}
      indeterminate={checked === 'indeterminate' || defaultChecked === 'indeterminate'}
      onChange={handleChange}
      className={className}
      classNames={{
        root: 'inline-flex',
        body: 'items-center',
        input: cn(
          'peer size-4 cursor-pointer rounded-[4px] border-input transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50'
        ),
      }}
      {...props}
    />
  );
}

export { Checkbox };
