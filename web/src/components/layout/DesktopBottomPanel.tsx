import { lazy, Suspense } from 'react';
import { ActionIcon, Group, SegmentedControl, Text } from '@mantine/core';
import { MessageSquare, PanelBottomClose, Users } from 'lucide-react';

import {
  useDesktopShell,
  type DesktopBottomPanel as DesktopBottomPanelId,
} from './DesktopShellContext';

const ChatPanel = lazy(() =>
  import('@/components/chat/ChatPanel').then((mod) => ({
    default: mod.ChatPanel,
  }))
);

const SquadChatPanel = lazy(() =>
  import('@/components/chat/SquadChatPanel').then((mod) => ({
    default: mod.SquadChatPanel,
  }))
);

const PANEL_OPTIONS = [
  { label: 'Board Chat', value: 'board-chat' },
  { label: 'Squad Chat', value: 'squad-chat' },
] satisfies Array<{ label: string; value: DesktopBottomPanelId }>;

export function DesktopBottomPanel() {
  const { isDesktopClient, bottomPanel, openBottomPanel, closeBottomPanel } = useDesktopShell();

  if (!isDesktopClient || !bottomPanel) return null;

  return (
    <section
      className="desktop-bottom-panel border-t border-border bg-card"
      aria-label="Desktop bottom panel"
    >
      <Group
        justify="space-between"
        wrap="nowrap"
        className="desktop-no-drag h-11 border-b border-border px-3"
      >
        <Group gap="xs" wrap="nowrap">
          {bottomPanel === 'board-chat' ? (
            <MessageSquare className="h-4 w-4 text-primary" aria-hidden="true" />
          ) : (
            <Users className="h-4 w-4 text-primary" aria-hidden="true" />
          )}
          <Text size="sm" fw={600}>
            Workbench
          </Text>
          <SegmentedControl
            size="xs"
            value={bottomPanel}
            onChange={(value) => openBottomPanel(value as DesktopBottomPanelId)}
            data={PANEL_OPTIONS}
            aria-label="Bottom panel"
          />
        </Group>
        <ActionIcon
          variant="subtle"
          color="gray"
          size={30}
          onClick={closeBottomPanel}
          aria-label="Close bottom panel"
          title="Close bottom panel"
        >
          <PanelBottomClose className="h-4 w-4" aria-hidden="true" />
        </ActionIcon>
      </Group>
      <div className="min-h-0 flex-1 overflow-hidden">
        <Suspense
          fallback={
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              Loading panel...
            </div>
          }
        >
          {bottomPanel === 'board-chat' ? (
            <ChatPanel open onOpenChange={(open) => !open && closeBottomPanel()} variant="inline" />
          ) : (
            <SquadChatPanel
              open
              onOpenChange={(open) => !open && closeBottomPanel()}
              variant="inline"
            />
          )}
        </Suspense>
      </div>
    </section>
  );
}
