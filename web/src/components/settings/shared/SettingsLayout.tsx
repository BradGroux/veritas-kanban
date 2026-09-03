import type { ReactNode } from 'react';
import { Alert, Group, Paper, Stack, Text } from '@mantine/core';
import { Info, TriangleAlert } from 'lucide-react';
import { SectionHeader } from './SectionHeader';

export function SettingsPage({
  title,
  description,
  actions,
  children,
}: {
  title: string;
  description: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Stack gap="lg" data-settings-page={title.toLowerCase().replace(/\s+/g, '-')}>
      <Group justify="space-between" align="flex-start" gap="md" wrap="wrap">
        <div className="min-w-0 max-w-2xl">
          <Text component="h2" size="lg" fw={700} lh={1.25}>
            {title}
          </Text>
          <Text size="sm" c="dimmed" mt={4}>
            {description}
          </Text>
        </div>
        {actions && <div className="shrink-0">{actions}</div>}
      </Group>
      {children}
    </Stack>
  );
}

export function SettingsSection({
  id,
  title,
  description,
  status,
  actions,
  onReset,
  tone = 'default',
  divided = false,
  children,
}: {
  id?: string;
  title: string;
  description?: string;
  status?: ReactNode;
  actions?: ReactNode;
  onReset?: () => void;
  tone?: 'default' | 'advanced' | 'danger';
  divided?: boolean;
  children: ReactNode;
}) {
  const headingId = id ? `${id}-heading` : undefined;

  return (
    <Paper
      component="section"
      id={id}
      aria-labelledby={headingId}
      withBorder
      radius="md"
      p={{ base: 'sm', sm: 'md' }}
      data-settings-section={tone}
      className={
        tone === 'danger'
          ? 'scroll-mt-16 border-red-500/35 bg-red-500/[0.035]'
          : tone === 'advanced'
            ? 'scroll-mt-16 bg-muted/20'
            : 'scroll-mt-16 bg-card'
      }
    >
      <SectionHeader
        id={headingId}
        title={title}
        description={description}
        status={status}
        actions={actions}
        onReset={onReset}
        contained
      />
      <div className={divided ? 'divide-y' : undefined}>{children}</div>
    </Paper>
  );
}

export function SettingsFieldGrid({ children }: { children: ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2" data-settings-field-grid>
      {children}
    </div>
  );
}

export function SettingsStatusCard({
  title,
  description,
  tone = 'neutral',
  actions,
}: {
  title: string;
  description: string;
  tone?: 'neutral' | 'success' | 'warning' | 'error';
  actions?: ReactNode;
}) {
  const color =
    tone === 'error'
      ? 'red'
      : tone === 'warning'
        ? 'yellow'
        : tone === 'success'
          ? 'green'
          : 'gray';
  const Icon = tone === 'warning' || tone === 'error' ? TriangleAlert : Info;

  return (
    <Alert
      color={color}
      variant="light"
      role={tone === 'warning' || tone === 'error' ? 'alert' : 'status'}
      icon={<Icon className="h-4 w-4" aria-hidden="true" />}
      title={title}
      data-settings-status={tone}
    >
      <Group justify="space-between" align="flex-start" gap="sm" wrap="wrap">
        <Text size="sm">{description}</Text>
        {actions}
      </Group>
    </Alert>
  );
}

export function SettingsLocalNav({
  label,
  items,
}: {
  label: string;
  items: Array<{ id: string; label: string }>;
}) {
  return (
    <nav
      aria-label={label}
      className="sticky top-0 z-10 -mx-1 overflow-x-auto bg-background/95 px-1 py-2 backdrop-blur"
    >
      <Group gap="xs" wrap="nowrap">
        {items.map((item) => (
          <a
            key={item.id}
            href={`#${item.id}`}
            className="whitespace-nowrap rounded-md border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground hover:border-primary/50 hover:text-foreground focus-visible:outline-2 focus-visible:outline-primary"
          >
            {item.label}
          </a>
        ))}
      </Group>
    </nav>
  );
}

export function SettingsHelpText({ children }: { children: ReactNode }) {
  return (
    <Text size="xs" c="dimmed" data-settings-help>
      {children}
    </Text>
  );
}

export function SettingsErrorText({ children }: { children: ReactNode }) {
  return (
    <Text size="xs" c="red" role="alert" data-settings-error>
      {children}
    </Text>
  );
}

export function SettingsActionGroup({
  label,
  tone = 'routine',
  children,
}: {
  label: string;
  tone?: 'routine' | 'danger';
  children: ReactNode;
}) {
  return (
    <Stack
      gap={4}
      aria-label={label}
      data-settings-actions={tone}
      className={tone === 'danger' ? 'border-t border-red-500/30 pt-2' : undefined}
    >
      <Text size="xs" c={tone === 'danger' ? 'red' : 'dimmed'} fw={700} tt="uppercase">
        {label}
      </Text>
      {children}
    </Stack>
  );
}

export function SettingsUnit({ children }: { children: ReactNode }) {
  return (
    <Text component="span" size="xs" c="dimmed" className="min-w-10 text-left">
      {children}
    </Text>
  );
}
