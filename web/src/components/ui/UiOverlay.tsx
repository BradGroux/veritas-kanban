import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  Drawer,
  Group,
  Modal,
  getDefaultZIndex,
  type GroupProps,
  type ModalProps,
} from '@mantine/core';
import { cn } from '@/lib/utils';

export const OVERLAY_VARIANTS = {
  confirm: { width: '28rem', presentation: 'dialog' },
  form: { width: '36rem', presentation: 'dialog' },
  authoring: { width: '65rem', presentation: 'dialog' },
  utility: { width: '38rem', presentation: 'drawer' },
  task: { width: '60rem', presentation: 'drawer' },
  chat: { width: '31rem', presentation: 'drawer' },
} as const;
export type OverlayVariant = keyof typeof OVERLAY_VARIANTS;

interface Entry {
  id: string;
  depth: number;
  trigger: HTMLElement | null;
}
const OverlayDepth = createContext(0);
const OverlayStack = createContext<{
  entries: Entry[];
  register: (entry: Entry) => () => void;
} | null>(null);

/** One focus/Escape stack for dialogs and utility panels, including unmounts. */
export function UiOverlayProvider({ children }: { children: ReactNode }) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const pendingRestores = useRef(new Map<string, Entry>());
  const register = useCallback((entry: Entry) => {
    setEntries((current) =>
      [...current.filter((item) => item.id !== entry.id), entry].sort((a, b) => a.depth - b.depth)
    );
    return () => {
      pendingRestores.current.set(entry.id, entry);
      setEntries((current) => current.filter((item) => item.id !== entry.id));
    };
  }, []);
  useEffect(() => {
    const closed = [...pendingRestores.current.values()]
      .filter((entry) => !entries.some((open) => open.id === entry.id))
      .sort((a, b) => a.depth - b.depth);
    pendingRestores.current.clear();
    if (!closed.length) return;
    // Child focus traps queue their initial focus during this commit. Restore
    // from the provider after those effects, not from the closing child's frame.
    const timer = window.setTimeout(() => {
      // If a whole subtree closes, restore the outer opener, not a child
      // control that is disappearing. Re-registered StrictMode entries do not restore.
      const target = closed
        .map((entry) => entry.trigger)
        .find((element) => element?.isConnected && element.getClientRects().length);
      target?.focus({ preventScroll: true });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [entries]);
  const value = useMemo(() => ({ entries, register }), [entries, register]);
  return <OverlayStack.Provider value={value}>{children}</OverlayStack.Provider>;
}

export type UiModalProps = Omit<ModalProps, 'variant' | 'size' | 'withinPortal'> & {
  variant?: OverlayVariant;
  /** A compound layout supplies its own single scrolling body and sticky footer. */
  compound?: boolean;
};

function useOverlayRegistration(
  opened: boolean,
  returnFocus: boolean,
  onExitTransitionEnd?: () => void
) {
  const id = useId();
  const depth = useContext(OverlayDepth);
  const stack = useContext(OverlayStack);
  const register = stack?.register;
  const opener = useRef<HTMLElement | null | undefined>(undefined);
  // Register before paint so a rapidly reopened surface is never inert for
  // the next keyboard event while a passive registration effect is pending.
  useLayoutEffect(() => {
    if (!opened) return;
    // Effect replay (including a lazy surface reveal) must not replace the
    // original opener with a field or background heading focused during mount.
    if (opener.current === undefined) {
      opener.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
    }
    const trigger = returnFocus ? opener.current : null;
    return register?.({ id, depth, trigger });
  }, [opened, register, id, depth, returnFocus]);
  const index = stack?.entries.findIndex((entry) => entry.id === id) ?? 0;
  const active = !stack || stack.entries.at(-1)?.id === id;
  return {
    active,
    depth,
    zIndex: getDefaultZIndex('modal') + Math.max(index, 0),
    onExitTransitionEnd: () => {
      // An interrupted exit retains its opener. Restore before a new surface
      // captures the target during an explicit overlay handoff.
      const target = opener.current;
      if (
        returnFocus &&
        onExitTransitionEnd &&
        target?.isConnected &&
        target.getClientRects().length
      ) {
        target.focus({ preventScroll: true });
      }
      opener.current = undefined;
      onExitTransitionEnd?.();
    },
  };
}

export function UiModal({
  variant = 'form',
  compound = false,
  children,
  classNames,
  closeButtonProps,
  closeOnEscape = true,
  trapFocus = true,
  returnFocus = true,
  ...props
}: UiModalProps) {
  const overlay = useOverlayRegistration(props.opened, returnFocus, props.onExitTransitionEnd);
  const { active, depth } = overlay;
  const definition = OVERLAY_VARIANTS[variant];

  return (
    <Modal
      {...props}
      size={definition.width}
      data-overlay-variant={variant}
      data-overlay-presentation={definition.presentation}
      data-overlay-compound={compound || undefined}
      data-overlay-active={active || undefined}
      inert={!active || undefined}
      classNames={(theme, modalProps, ctx) => {
        const extra =
          typeof classNames === 'function' ? classNames(theme, modalProps, ctx) : classNames;
        return {
          ...extra,
          content: cn('vk-overlay-content', extra?.content),
          header: cn('vk-overlay-header', extra?.header),
          title: cn('vk-overlay-title', extra?.title),
          close: cn('vk-overlay-close', extra?.close),
          body: cn('vk-overlay-body', extra?.body),
          inner: cn('vk-overlay-inner', extra?.inner),
        };
      }}
      zIndex={overlay.zIndex}
      transitionProps={{ transition: 'fade', duration: 150, ...props.transitionProps }}
      onExitTransitionEnd={overlay.onExitTransitionEnd}
      lockScroll
      closeOnEscape={active && closeOnEscape}
      closeOnClickOutside={active && (props.closeOnClickOutside ?? true)}
      trapFocus={active && trapFocus}
      returnFocus={false}
      closeButtonProps={{
        'aria-label': 'Close dialog',
        title: 'Close',
        ...closeButtonProps,
        size: '2.125rem',
      }}
    >
      <OverlayDepth.Provider value={depth + 1}>{children}</OverlayDepth.Provider>
    </Modal>
  );
}

interface UiTaskSurfaceProps {
  opened: boolean;
  onClose: () => void;
  label: string;
  expanded: boolean;
  chatOpen: boolean;
  closeOnEscape?: boolean;
  trapFocus?: boolean;
  children: ReactNode;
}

/** Stateful task workspace geometry participates in the same stack as its tools. */
export function UiTaskSurface({
  opened,
  onClose,
  label,
  expanded,
  chatOpen,
  closeOnEscape = true,
  trapFocus = true,
  children,
}: UiTaskSurfaceProps) {
  const overlay = useOverlayRegistration(opened, true);
  return (
    <OverlayDepth.Provider value={overlay.depth + 1}>
      <Drawer.Root
        opened={opened}
        onClose={onClose}
        position="right"
        size={
          expanded
            ? '100vw'
            : `min(100vw, calc(${OVERLAY_VARIANTS.task.width} + ${chatOpen ? OVERLAY_VARIANTS.chat.width : '0rem'}))`
        }
        zIndex={overlay.zIndex}
        lockScroll
        returnFocus={false}
        trapFocus={overlay.active && trapFocus}
        closeOnEscape={overlay.active && closeOnEscape}
        closeOnClickOutside={overlay.active}
        onExitTransitionEnd={overlay.onExitTransitionEnd}
      >
        <Drawer.Overlay className="veritas-overlay" />
        <Drawer.Content
          aria-label={label}
          data-overlay-variant="task"
          data-overlay-active={overlay.active || undefined}
          data-presentation={expanded ? 'expanded' : 'drawer'}
          data-testid="task-detail-panel"
          data-chat-open={chatOpen || undefined}
          inert={!overlay.active || undefined}
          classNames={{
            content:
              'veritas-overlay-surface vk-task-workspace flex h-full min-h-0 max-h-[100dvh] flex-col overflow-hidden border-l bg-background bg-clip-padding text-sm shadow-lg',
          }}
        >
          <Drawer.Body className="flex min-h-0 flex-1 flex-col overflow-hidden p-0">
            {children}
          </Drawer.Body>
        </Drawer.Content>
      </Drawer.Root>
    </OverlayDepth.Provider>
  );
}

/** Utility drawers use the same modal stack; nested panels become centered dialogs. */
export function UiDrawer({
  variant = 'utility',
  position: _position,
  ...props
}: UiModalProps & { position?: 'right' }) {
  const depth = useContext(OverlayDepth);
  return <UiModal {...props} variant={depth > 0 ? 'authoring' : variant} />;
}

export function OverlayFooter({ className, ...props }: GroupProps & { children: ReactNode }) {
  return (
    <Group {...props} justify="flex-end" gap="sm" className={cn('vk-overlay-footer', className)} />
  );
}

/** Sequence in-app navigation after a closing overlay, retaining its outer opener. */
export function useOverlayHandoff<T>(opened: boolean, execute: (target: T) => void) {
  const pending = useRef<{ target: T } | null>(null);
  useEffect(() => {
    if (opened) pending.current = null;
  }, [opened]);
  useEffect(
    () => () => {
      pending.current = null;
    },
    []
  );
  return {
    queue: (target: T) => {
      pending.current = { target };
    },
    onExitTransitionEnd: () => {
      const handoff = pending.current;
      if (!handoff) return;
      window.requestAnimationFrame(() => {
        // Reopening, unmounting, or a newer selection invalidates this handoff.
        if (pending.current !== handoff) return;
        pending.current = null;
        execute(handoff.target);
      });
    },
  };
}
