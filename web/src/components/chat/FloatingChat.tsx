import { lazy, Suspense, useState, useEffect } from 'react';
import { ActionIcon } from '@mantine/core';
import { MessageSquare } from 'lucide-react';
import { chatEventTarget } from '@/hooks/useTaskSync';
import { cn } from '@/lib/utils';

const ChatPanel = lazy(() =>
  import('./ChatPanel').then((mod) => ({
    default: mod.ChatPanel,
  }))
);

/**
 * Floating chat bubble — bottom-right corner.
 * Opens a board-level ChatPanel (no taskId).
 * Pulses when a new response arrives while closed.
 */
export function FloatingChat() {
  const [open, setOpen] = useState(false);
  const [panelMounted, setPanelMounted] = useState(false);
  const [hasUnread, setHasUnread] = useState(false);

  // Listen for incoming chat messages when panel is closed
  useEffect(() => {
    const handler = (e: Event) => {
      const msg = (e as CustomEvent).detail;
      // Only pulse for board-level chat messages (no taskId in sessionId)
      if (
        !open &&
        (msg.type === 'chat:message' || msg.type === 'chat:delta') &&
        msg.sessionId &&
        !msg.sessionId.includes('task_')
      ) {
        setHasUnread(true);
      }
    };

    chatEventTarget.addEventListener('chat', handler);
    return () => chatEventTarget.removeEventListener('chat', handler);
  }, [open]);

  // Clear unread when opening
  const handleOpen = () => {
    setPanelMounted(true);
    setOpen(true);
    setHasUnread(false);
  };

  return (
    <>
      {/* Floating button */}
      <ActionIcon
        onClick={handleOpen}
        size={56}
        radius="xl"
        variant="filled"
        className={cn(
          'fixed bottom-6 right-6 z-40 h-14 w-14 rounded-full shadow-lg',
          'bg-primary hover:bg-primary/90 text-primary-foreground',
          'transition-all duration-200 hover:scale-105',
          open && 'hidden'
        )}
        aria-label="Open chat"
      >
        <MessageSquare className="h-6 w-6" />
        {hasUnread && (
          <span className="absolute -top-1 -right-1 flex h-4 w-4">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-4 w-4 bg-emerald-500" />
          </span>
        )}
      </ActionIcon>

      {/* Chat panel — board-level (no taskId) */}
      {panelMounted && (
        <Suspense fallback={null}>
          <ChatPanel open={open} onOpenChange={setOpen} />
        </Suspense>
      )}
    </>
  );
}
