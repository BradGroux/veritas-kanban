import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Group, Modal, getDefaultZIndex, type GroupProps, type ModalProps } from '@mantine/core';
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
  const id = useId();
  const depth = useContext(OverlayDepth);
  const stack = useContext(OverlayStack);
  const register = stack?.register;
  useEffect(() => {
    if (!props.opened) return;
    const trigger =
      returnFocus && document.activeElement instanceof HTMLElement ? document.activeElement : null;
    return register?.({ id, depth, trigger });
  }, [props.opened, register, id, depth, returnFocus]);
  const index = stack?.entries.findIndex((entry) => entry.id === id) ?? 0;
  const active = !stack || stack.entries.at(-1)?.id === id;
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
      zIndex={getDefaultZIndex('modal') + Math.max(index, 0)}
      transitionProps={{ transition: 'fade', duration: 150, ...props.transitionProps }}
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
