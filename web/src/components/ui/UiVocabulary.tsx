import { forwardRef, type ComponentProps, type ReactNode } from 'react';
import {
  ActionIcon,
  Badge,
  Button,
  Paper,
  Stack,
  Text,
  createPolymorphicComponent,
  type ActionIconProps,
  type BadgeProps,
  type ButtonProps,
  type PaperProps,
} from '@mantine/core';

import { cn } from '@/lib/utils';
import {
  VERITAS_TONE_TO_MANTINE_COLOR,
  VERITAS_UI_METRICS,
  type VeritasSemanticTone,
} from '@/theme/ui-contract';

export type UiActionVariant = 'primary' | 'secondary' | 'quiet' | 'destructive';
export type UiSurfaceLevel = 'section' | 'card' | 'inset' | 'empty';
export type UiPillKind = 'neutral' | 'count' | 'selected' | 'status';

/** Migration boundary for existing data-status helpers, never for action styling. */
export function semanticToneForLegacyColor(color: string): VeritasSemanticTone {
  if (['green', 'teal'].includes(color)) return 'success';
  if (['yellow', 'orange'].includes(color)) return 'warning';
  if (['red', 'pink'].includes(color)) return 'error';
  if (['blue', 'cyan', 'indigo'].includes(color)) return 'info';
  return 'neutral';
}

const ACTION_PRESENTATION = {
  primary: { variant: 'filled', color: 'veritas' },
  secondary: { variant: 'outline', color: 'gray' },
  quiet: { variant: 'subtle', color: 'gray' },
  destructive: { variant: 'filled', color: 'red' },
} as const;

type UiActionProps = Omit<ButtonProps, 'variant' | 'color' | 'size'> &
  Omit<ComponentProps<'button'>, keyof ButtonProps> & {
    variant?: UiActionVariant;
  };

export const UiAction = createPolymorphicComponent<'button', UiActionProps>(
  forwardRef<HTMLButtonElement, UiActionProps>(function UiAction(
    { variant = 'primary', className, children, ...props },
    ref
  ) {
    const presentation = ACTION_PRESENTATION[variant];

    return (
      <Button
        {...props}
        ref={ref}
        variant={presentation.variant}
        color={presentation.color}
        size="sm"
        data-ui-action={variant}
        className={cn('vk-ui-action', className)}
      >
        {children}
      </Button>
    );
  })
);

type UiIconActionProps = Omit<ActionIconProps, 'variant' | 'color' | 'size'> &
  Omit<ComponentProps<'button'>, keyof ActionIconProps> & {
    'aria-label': string;
    variant?: UiActionVariant;
  };

export const UiIconAction = createPolymorphicComponent<'button', UiIconActionProps>(
  forwardRef<HTMLButtonElement, UiIconActionProps>(function UiIconAction(
    { variant = 'quiet', className, children, ...props },
    ref
  ) {
    const presentation = ACTION_PRESENTATION[variant];

    return (
      <ActionIcon
        {...props}
        ref={ref}
        variant={presentation.variant}
        color={presentation.color}
        size={VERITAS_UI_METRICS.iconActionSize}
        data-ui-action={variant}
        data-ui-icon-action
        className={cn('vk-ui-icon-action', className)}
      >
        {children}
      </ActionIcon>
    );
  })
);

type UiSurfaceProps = Omit<PaperProps, 'radius'> &
  Omit<ComponentProps<'div'>, keyof PaperProps> & {
    component?: 'div' | 'section';
    level?: UiSurfaceLevel;
    accent?: 'error' | 'warning';
    interactive?: boolean;
  };

export function UiSurface({
  level = 'card',
  accent,
  interactive,
  className,
  children,
  ...props
}: UiSurfaceProps) {
  return (
    <Paper
      {...props}
      radius={VERITAS_UI_METRICS.surfaceRadius}
      data-ui-surface={level}
      data-ui-accent={accent}
      data-ui-interactive={interactive || undefined}
      className={cn('vk-ui-surface', className)}
    >
      {children}
    </Paper>
  );
}

export const UiHeading = forwardRef<HTMLHeadingElement, ComponentProps<'h2'> & { order?: 2 | 3 }>(
  function UiHeading({ order = 2, className, ...props }, ref) {
    const Element = order === 2 ? 'h2' : 'h3';
    return (
      <Element
        {...props}
        ref={ref}
        data-ui-heading={order}
        className={cn('vk-ui-heading', className)}
      />
    );
  }
);

type UiPillProps = Omit<BadgeProps, 'variant' | 'color' | 'radius' | 'size'> &
  Omit<ComponentProps<'div'>, keyof BadgeProps> & {
    kind?: UiPillKind;
    tone?: VeritasSemanticTone;
  };

export function UiPill({
  kind = 'neutral',
  tone = 'neutral',
  className,
  children,
  ...props
}: UiPillProps) {
  const resolvedTone = kind === 'selected' ? 'selection' : tone;
  const variant = kind === 'neutral' || kind === 'count' ? 'outline' : 'light';

  return (
    <Badge
      {...props}
      variant={variant}
      color={VERITAS_TONE_TO_MANTINE_COLOR[resolvedTone]}
      radius={VERITAS_UI_METRICS.pillRadius}
      size="sm"
      tt="none"
      data-ui-pill={kind}
      data-ui-tone={resolvedTone}
      className={cn('vk-ui-pill', className)}
    >
      {children}
    </Badge>
  );
}

export function UiSectionHeading({
  title,
  description,
  actions,
  id,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  id?: string;
  className?: string;
}) {
  return (
    <div className={cn('flex min-w-0 items-start justify-between gap-3', className)}>
      <Stack gap={2} className="min-w-0">
        <UiHeading id={id}>{title}</UiHeading>
        {description && (
          <Text size="sm" c="dimmed" className="vk-ui-supporting-text">
            {description}
          </Text>
        )}
      </Stack>
      {actions && <div className="shrink-0">{actions}</div>}
    </div>
  );
}

export function UiEmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <UiSurface level="empty" className={cn('vk-ui-empty-state', className)}>
      {icon}
      <Text fw={650}>{title}</Text>
      {description && (
        <Text size="sm" c="dimmed" maw={520} ta="center">
          {description}
        </Text>
      )}
      {action}
    </UiSurface>
  );
}
