import * as React from 'react';
import {
  ActionIcon as MantineActionIcon,
  Button as MantineButton,
  type ActionIconProps as MantineActionIconProps,
  type ButtonProps as MantineButtonProps,
} from '@mantine/core';
import { cva, type VariantProps } from 'class-variance-authority';
import { Slot } from 'radix-ui';

import { cn } from '@/lib/utils';

const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-lg border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap transition-all outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground [a]:hover:bg-primary/80',
        outline:
          'border-border bg-background hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:border-input dark:bg-input/30 dark:hover:bg-input/50',
        secondary:
          'bg-secondary text-secondary-foreground hover:bg-secondary/80 aria-expanded:bg-secondary aria-expanded:text-secondary-foreground',
        ghost:
          'hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:hover:bg-muted/50',
        destructive:
          'bg-destructive/10 text-destructive hover:bg-destructive/20 focus-visible:border-destructive/40 focus-visible:ring-destructive/20 dark:bg-destructive/20 dark:hover:bg-destructive/30 dark:focus-visible:ring-destructive/40',
        link: 'text-primary underline-offset-4 hover:underline',
      },
      size: {
        default:
          'h-8 gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2',
        xs: "h-6 gap-1 rounded-[min(var(--radius-md),10px)] px-2 text-xs in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-7 gap-1 rounded-[min(var(--radius-md),12px)] px-2.5 text-[0.8rem] in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5",
        lg: 'h-9 gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-3 has-data-[icon=inline-start]:pl-3',
        icon: 'size-8',
        'icon-xs':
          "size-6 rounded-[min(var(--radius-md),10px)] in-data-[slot=button-group]:rounded-lg [&_svg:not([class*='size-'])]:size-3",
        'icon-sm':
          'size-7 rounded-[min(var(--radius-md),12px)] in-data-[slot=button-group]:rounded-lg',
        'icon-lg': 'size-9',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
);

const mantineButtonVariant = {
  default: 'filled',
  outline: 'outline',
  secondary: 'light',
  ghost: 'subtle',
  destructive: 'light',
  link: 'transparent',
} as const satisfies Record<
  NonNullable<VariantProps<typeof buttonVariants>['variant']>,
  MantineButtonProps['variant']
>;

const mantineButtonSize = {
  default: 'sm',
  xs: 'xs',
  sm: 'xs',
  lg: 'md',
  icon: 'sm',
  'icon-xs': 'xs',
  'icon-sm': 'xs',
  'icon-lg': 'md',
} as const satisfies Record<NonNullable<VariantProps<typeof buttonVariants>['size']>, string>;

const mantineActionIconSize = {
  icon: 32,
  'icon-xs': 24,
  'icon-sm': 28,
  'icon-lg': 36,
} as const;

function Button({
  className,
  variant = 'default',
  size = 'default',
  asChild = false,
  ...props
}: React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  const resolvedVariant = variant ?? 'default';
  const resolvedSize = size ?? 'default';
  const classes = cn(buttonVariants({ variant: resolvedVariant, size: resolvedSize, className }));
  const color = resolvedVariant === 'destructive' ? 'red' : undefined;

  if (asChild) {
    return (
      <Slot.Root
        data-slot="button"
        data-variant={resolvedVariant}
        data-size={resolvedSize}
        className={classes}
        {...props}
      />
    );
  }

  if (resolvedSize.startsWith('icon')) {
    const actionIconProps = props as MantineActionIconProps & React.ComponentProps<'button'>;

    return (
      <MantineActionIcon
        data-slot="button"
        data-variant={resolvedVariant}
        data-size={resolvedSize}
        variant={mantineButtonVariant[resolvedVariant]}
        color={color}
        size={mantineActionIconSize[resolvedSize as keyof typeof mantineActionIconSize]}
        className={classes}
        {...actionIconProps}
      />
    );
  }

  return (
    <MantineButton
      data-slot="button"
      data-variant={resolvedVariant}
      data-size={resolvedSize}
      variant={mantineButtonVariant[resolvedVariant]}
      color={color}
      size={mantineButtonSize[resolvedSize]}
      className={classes}
      {...(props as MantineButtonProps & React.ComponentProps<'button'>)}
    />
  );
}

export { Button, buttonVariants };
