import { createContext, useContext, type ComponentProps, type ReactNode } from 'react';
import { Alert, Group, Stack, Text, type AlertProps } from '@mantine/core';
import { UiAction, UiSurface, UiHeading } from '@/components/ui/UiVocabulary';
import type { VeritasSemanticTone } from '@/theme/ui-contract';
import { Info, TriangleAlert } from 'lucide-react';
import { SectionHeader } from './SectionHeader';

// Context crosses tab subcomponents, so nested groups cannot add a third card border.
const SettingsDepth = createContext(0);

export function SettingsGroup({
  children,
  empty = false,
  className,
  ...props
}: Omit<ComponentProps<typeof UiSurface>, 'level'> & { empty?: boolean }) {
  const depth = useContext(SettingsDepth);
  return (
    <UiSurface
      p="sm"
      {...props}
      level={depth >= 2 ? 'section' : empty ? 'empty' : depth === 0 ? 'card' : 'inset'}
      className={[empty && 'settings-empty', className].filter(Boolean).join(' ')}
      data-settings-group={empty ? 'empty' : depth}
    >
      <SettingsDepth.Provider value={depth + 1}>{children}</SettingsDepth.Provider>
    </UiSurface>
  );
}

export function SettingsNotice({
  tone = 'neutral',
  children,
  ...props
}: Omit<AlertProps, 'variant' | 'color' | 'radius' | 'styles'> & {
  tone?: Exclude<VeritasSemanticTone, 'selection'>;
}) {
  const depth = useContext(SettingsDepth);
  return (
    <Alert
      {...props}
      role={tone === 'error' || tone === 'warning' || tone === 'blocked' ? 'alert' : 'status'}
      data-settings-notice={tone}
      radius="md"
      p="sm"
      styles={{
        root: {
          color: `var(--vk-semantic-${tone}-fg)`,
          background: `var(--vk-semantic-${tone}-bg)`,
          border: depth < 2 ? `1px solid var(--vk-semantic-${tone}-border)` : '0',
        },
        title: { color: 'inherit', fontSize: '0.8125rem', fontWeight: 650 },
        message: { color: 'inherit', fontSize: '0.8125rem', lineHeight: 1.45 },
        icon: { color: 'inherit' },
      }}
    >
      <SettingsDepth.Provider value={depth + 1}>{children}</SettingsDepth.Provider>
    </Alert>
  );
}

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
          <UiHeading>{title}</UiHeading>
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
    <UiSurface
      component="section"
      id={id}
      aria-labelledby={headingId}
      p={{ base: 'sm', sm: 'md' }}
      data-settings-section={tone}
      accent={tone === 'danger' ? 'error' : undefined}
      className="scroll-mt-16"
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
      <SettingsDepth.Provider value={1}>
        <div className={divided ? 'divide-y' : undefined}>{children}</div>
      </SettingsDepth.Provider>
    </UiSurface>
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
  const Icon = tone === 'warning' || tone === 'error' ? TriangleAlert : Info;

  return (
    <SettingsNotice
      tone={tone}
      icon={<Icon className="h-4 w-4" aria-hidden="true" />}
      title={title}
      data-settings-status={tone}
    >
      <Group justify="space-between" align="flex-start" gap="sm" wrap="wrap">
        <Text size="sm">{description}</Text>
        {actions}
      </Group>
    </SettingsNotice>
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
          <UiAction
            component="a"
            variant="secondary"
            key={item.id}
            href={`#${item.id}`}
            className="shrink-0"
          >
            {item.label}
          </UiAction>
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
