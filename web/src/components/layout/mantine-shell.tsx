import type { ReactNode } from 'react';
import {
  AppShell,
  Box,
  Group,
  ScrollArea,
  Stack,
  type AppShellNavbarConfiguration,
  type BoxProps,
  type GroupProps,
  type StackProps,
} from '@mantine/core';

interface VeritasAppShellProps {
  header: ReactNode;
  children: ReactNode;
  sidebar?: ReactNode;
  navbar?: Partial<AppShellNavbarConfiguration>;
}

export function VeritasAppShell({ header, children, sidebar, navbar }: VeritasAppShellProps) {
  return (
    <AppShell
      header={{ height: 56 }}
      navbar={
        sidebar
          ? {
              width: 280,
              breakpoint: 'md',
              collapsed: { mobile: true },
              ...navbar,
            }
          : undefined
      }
      padding="md"
    >
      <AppShell.Header>{header}</AppShell.Header>
      {sidebar ? (
        <AppShell.Navbar>
          <ScrollArea h="100%">{sidebar}</ScrollArea>
        </AppShell.Navbar>
      ) : null}
      <AppShell.Main>{children}</AppShell.Main>
    </AppShell>
  );
}

export function VeritasHeaderActions({ children, ...props }: GroupProps) {
  return (
    <Group gap="xs" justify="flex-end" wrap="nowrap" {...props}>
      {children}
    </Group>
  );
}

export function VeritasSideNav({ children, ...props }: StackProps) {
  return (
    <Stack gap={4} p="sm" {...props}>
      {children}
    </Stack>
  );
}

export function VeritasPanel({ children, ...props }: BoxProps & { children: ReactNode }) {
  return (
    <Box
      bg="var(--mantine-color-body)"
      p="md"
      style={{
        border: '1px solid var(--mantine-color-default-border)',
        borderRadius: 'var(--mantine-radius-md)',
      }}
      {...props}
    >
      {children}
    </Box>
  );
}

export function VeritasDialogStack({ children, ...props }: StackProps) {
  return (
    <Stack gap="md" {...props}>
      {children}
    </Stack>
  );
}
