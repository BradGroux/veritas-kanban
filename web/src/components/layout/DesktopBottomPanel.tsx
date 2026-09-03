import {
  Activity,
  lazy,
  Suspense,
  useRef,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type WheelEvent,
} from 'react';
import { ActionIcon, Group, SegmentedControl, Text } from '@mantine/core';
import { GripVertical, MessageSquare, Users, X } from 'lucide-react';

import {
  MAX_RIGHT_PANEL_WIDTH,
  MIN_RIGHT_PANEL_WIDTH,
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
    isDesktopClient,
    bottomPanel,
    rightPanelWidth,
    setRightPanelWidth,
    openBottomPanel,
    closeBottomPanel,
  } = useDesktopShell();
  const dragStateRef = useRef<{ startPosition: number; startSize: number } | null>(null);

  if (!isDesktopClient) return null;

  const resizeBy = (delta: number) => {
    setRightPanelWidth(rightPanelWidth + delta);
  };

  const handleResizePointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    dragStateRef.current = {
      startPosition: event.clientX,
      startSize: rightPanelWidth,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handleResizePointerMove = (event: PointerEvent<HTMLButtonElement>) => {
    if (!dragStateRef.current) return;
    const delta = dragStateRef.current.startPosition - event.clientX;
    setRightPanelWidth(dragStateRef.current.startSize + delta);
  };

  const handleResizePointerEnd = (event: PointerEvent<HTMLButtonElement>) => {
    dragStateRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const handleResizeKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      resizeBy(event.shiftKey ? 80 : 24);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      resizeBy(event.shiftKey ? -80 : -24);
    } else if (event.key === 'Home') {
      event.preventDefault();
      setRightPanelWidth(MIN_RIGHT_PANEL_WIDTH);
    } else if (event.key === 'End') {
      event.preventDefault();
      setRightPanelWidth(MAX_RIGHT_PANEL_WIDTH);
    }
  };

  const handleResizeWheel = (event: WheelEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
  };

  return (
    <section
      id="workbench-right-dock"
      className="workbench-chat-dock workbench-chat-dock--right bg-card"
      aria-label="Workbench right dock"
      hidden={!bottomPanel}
      data-dock-position="right"
      style={
        {
          '--workbench-right-panel-width': `${rightPanelWidth}px`,
          display: bottomPanel ? undefined : 'none',
        } as CSSProperties
      }
    >
      <button
        type="button"
        className="workbench-chat-dock-resizer desktop-no-drag"
        aria-label="Resize right dock"
        aria-orientation="vertical"
        title="Drag to resize right dock"
        onPointerDown={handleResizePointerDown}
        onPointerMove={handleResizePointerMove}
        onPointerUp={handleResizePointerEnd}
        onPointerCancel={handleResizePointerEnd}
        onKeyDown={handleResizeKeyDown}
        onWheel={handleResizeWheel}
      >
        <GripVertical className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
      <div className="desktop-no-drag shrink-0 space-y-2 border-b border-border px-3 py-2">
        <Group justify="space-between" wrap="nowrap">
          <Group gap="xs" wrap="nowrap">
            {bottomPanel === 'board-chat' ? (
              <MessageSquare className="h-4 w-4 text-primary" aria-hidden="true" />
            ) : (
              <Users className="h-4 w-4 text-primary" aria-hidden="true" />
            )}
            <Text size="sm" fw={600}>
              Workbench
            </Text>
          </Group>
          <Group gap={4} wrap="nowrap">
            <ActionIcon
              variant="subtle"
              color="gray"
              size={30}
              onClick={closeBottomPanel}
              aria-label="Close right dock"
              title="Close right dock"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </ActionIcon>
          </Group>
        </Group>
        <Group wrap="nowrap">
          <SegmentedControl
            size="xs"
            value={bottomPanel ?? 'board-chat'}
            onChange={(value) => openBottomPanel(value as DesktopBottomPanelId)}
            data={PANEL_OPTIONS}
            aria-label="Chat channel"
          />
        </Group>
      </div>
      <div className="workbench-chat-dock-content min-h-0 flex-1 overflow-hidden">
        <Suspense
          fallback={
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              Loading panel...
            </div>
          }
        >
          {/* Preserve drafts/session state while suspending hidden channel effects. */}
          <Activity mode={bottomPanel === 'board-chat' ? 'visible' : 'hidden'}>
            <ChatPanel
              open={bottomPanel === 'board-chat'}
              onOpenChange={(open) => !open && closeBottomPanel()}
              variant="inline"
            />
          </Activity>
          <Activity mode={bottomPanel === 'squad-chat' ? 'visible' : 'hidden'}>
            <SquadChatPanel
              open={bottomPanel === 'squad-chat'}
              onOpenChange={(open) => !open && closeBottomPanel()}
              variant="inline"
            />
          </Activity>
        </Suspense>
      </div>
    </section>
  );
}
