import {
  lazy,
  Suspense,
  useRef,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type WheelEvent,
} from 'react';
import { ActionIcon, Group, SegmentedControl, Text } from '@mantine/core';
import {
  GripHorizontal,
  GripVertical,
  MessageSquare,
  PanelBottomClose,
  PanelRightClose,
  Users,
} from 'lucide-react';

import {
  MAX_BOTTOM_PANEL_HEIGHT,
  MAX_RIGHT_PANEL_WIDTH,
  MIN_BOTTOM_PANEL_HEIGHT,
  MIN_RIGHT_PANEL_WIDTH,
  useDesktopShell,
  type DesktopBottomPanel as DesktopBottomPanelId,
  type DesktopDockPosition,
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

const DOCK_OPTIONS = [
  { label: 'Right', value: 'right' },
  { label: 'Bottom', value: 'bottom' },
] satisfies Array<{ label: string; value: DesktopDockPosition }>;

export function DesktopBottomPanel() {
  const {
    isDesktopClient,
    bottomPanel,
    dockPosition,
    bottomPanelHeight,
    rightPanelWidth,
    setDockPosition,
    setBottomPanelHeight,
    setRightPanelWidth,
    openBottomPanel,
    closeBottomPanel,
  } = useDesktopShell();
  const dragStateRef = useRef<{ startPosition: number; startSize: number } | null>(null);

  if (!bottomPanel) return null;

  const resizeBy = (delta: number) => {
    if (dockPosition === 'right') {
      setRightPanelWidth(rightPanelWidth + delta);
    } else {
      setBottomPanelHeight(bottomPanelHeight + delta);
    }
  };

  const handleResizePointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    dragStateRef.current = {
      startPosition: dockPosition === 'right' ? event.clientX : event.clientY,
      startSize: dockPosition === 'right' ? rightPanelWidth : bottomPanelHeight,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handleResizePointerMove = (event: PointerEvent<HTMLButtonElement>) => {
    if (!dragStateRef.current) return;
    const currentPosition = dockPosition === 'right' ? event.clientX : event.clientY;
    const delta = dragStateRef.current.startPosition - currentPosition;
    if (dockPosition === 'right') {
      setRightPanelWidth(dragStateRef.current.startSize + delta);
    } else {
      setBottomPanelHeight(dragStateRef.current.startSize + delta);
    }
  };

  const handleResizePointerEnd = (event: PointerEvent<HTMLButtonElement>) => {
    dragStateRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const handleResizeKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const growKey = dockPosition === 'right' ? 'ArrowLeft' : 'ArrowUp';
    const shrinkKey = dockPosition === 'right' ? 'ArrowRight' : 'ArrowDown';
    if (event.key === growKey) {
      event.preventDefault();
      resizeBy(event.shiftKey ? 80 : 24);
    } else if (event.key === shrinkKey) {
      event.preventDefault();
      resizeBy(event.shiftKey ? -80 : -24);
    } else if (event.key === 'Home') {
      event.preventDefault();
      if (dockPosition === 'right') {
        setRightPanelWidth(MIN_RIGHT_PANEL_WIDTH);
      } else {
        setBottomPanelHeight(MIN_BOTTOM_PANEL_HEIGHT);
      }
    } else if (event.key === 'End') {
      event.preventDefault();
      if (dockPosition === 'right') {
        setRightPanelWidth(MAX_RIGHT_PANEL_WIDTH);
      } else {
        setBottomPanelHeight(MAX_BOTTOM_PANEL_HEIGHT);
      }
    }
  };

  const handleResizeWheel = (event: WheelEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
  };

  const orientationLabel = dockPosition === 'right' ? 'right dock' : 'bottom dock';

  return (
    <section
      className={`workbench-chat-dock workbench-chat-dock--${dockPosition} bg-card`}
      aria-label={`Workbench ${orientationLabel}`}
      data-dock-position={dockPosition}
      style={
        {
          '--workbench-bottom-panel-height': `${bottomPanelHeight}px`,
          '--workbench-right-panel-width': `${rightPanelWidth}px`,
        } as CSSProperties
      }
    >
      <button
        type="button"
        className="workbench-chat-dock-resizer desktop-no-drag"
        aria-label={`Resize ${orientationLabel}`}
        aria-orientation={dockPosition === 'right' ? 'vertical' : 'horizontal'}
        title={`Drag to resize ${orientationLabel}`}
        onPointerDown={handleResizePointerDown}
        onPointerMove={handleResizePointerMove}
        onPointerUp={handleResizePointerEnd}
        onPointerCancel={handleResizePointerEnd}
        onKeyDown={handleResizeKeyDown}
        onWheel={handleResizeWheel}
      >
        {dockPosition === 'right' ? (
          <GripVertical className="h-3.5 w-3.5" aria-hidden="true" />
        ) : (
          <GripHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
        )}
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
            {isDesktopClient && (
              <SegmentedControl
                size="xs"
                value={dockPosition}
                onChange={(value) => setDockPosition(value as DesktopDockPosition)}
                data={DOCK_OPTIONS}
                aria-label="Dock position"
              />
            )}
            <ActionIcon
              variant="subtle"
              color="gray"
              size={30}
              onClick={closeBottomPanel}
              aria-label={`Close ${orientationLabel}`}
              title={`Close ${orientationLabel}`}
            >
              {dockPosition === 'right' ? (
                <PanelRightClose className="h-4 w-4" aria-hidden="true" />
              ) : (
                <PanelBottomClose className="h-4 w-4" aria-hidden="true" />
              )}
            </ActionIcon>
          </Group>
        </Group>
        <Group wrap="nowrap">
          <SegmentedControl
            size="xs"
            value={bottomPanel}
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
