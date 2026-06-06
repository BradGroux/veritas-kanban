import {
  lazy,
  Suspense,
  useRef,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
} from 'react';
import { ActionIcon, Group, SegmentedControl, Text } from '@mantine/core';
import { GripHorizontal, MessageSquare, PanelBottomClose, Users } from 'lucide-react';

import {
  MAX_BOTTOM_PANEL_HEIGHT,
  MIN_BOTTOM_PANEL_HEIGHT,
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
  const {
    bottomPanel,
    bottomPanelHeight,
    setBottomPanelHeight,
    openBottomPanel,
    closeBottomPanel,
  } = useDesktopShell();
  const dragStateRef = useRef<{ startY: number; startHeight: number } | null>(null);

  if (!bottomPanel) return null;

  const resizeBy = (delta: number) => {
    setBottomPanelHeight(bottomPanelHeight + delta);
  };

  const handleResizePointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    dragStateRef.current = {
      startY: event.clientY,
      startHeight: bottomPanelHeight,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handleResizePointerMove = (event: PointerEvent<HTMLButtonElement>) => {
    if (!dragStateRef.current) return;
    const delta = dragStateRef.current.startY - event.clientY;
    setBottomPanelHeight(dragStateRef.current.startHeight + delta);
  };

  const handleResizePointerEnd = (event: PointerEvent<HTMLButtonElement>) => {
    dragStateRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const handleResizeKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      resizeBy(event.shiftKey ? 80 : 24);
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      resizeBy(event.shiftKey ? -80 : -24);
    } else if (event.key === 'Home') {
      event.preventDefault();
      setBottomPanelHeight(MIN_BOTTOM_PANEL_HEIGHT);
    } else if (event.key === 'End') {
      event.preventDefault();
      setBottomPanelHeight(MAX_BOTTOM_PANEL_HEIGHT);
    }
  };

  return (
    <section
      className="workbench-bottom-panel border-t border-border bg-card"
      aria-label="Workbench bottom panel"
      style={{ '--workbench-bottom-panel-height': `${bottomPanelHeight}px` } as CSSProperties}
    >
      <button
        type="button"
        className="workbench-bottom-panel-resizer desktop-no-drag"
        aria-label="Resize workbench panel"
        title="Drag to resize workbench panel"
        onPointerDown={handleResizePointerDown}
        onPointerMove={handleResizePointerMove}
        onPointerUp={handleResizePointerEnd}
        onPointerCancel={handleResizePointerEnd}
        onKeyDown={handleResizeKeyDown}
      >
        <GripHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
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
