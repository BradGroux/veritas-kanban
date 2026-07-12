'use client';

import * as React from 'react';
import { Modal } from '@mantine/core';
import { XIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type DialogContextValue = {
  modalId: string;
  open: boolean;
  setOpen: (open: boolean) => void;
};

const DialogContext = React.createContext<DialogContextValue | null>(null);

function useDialogContext(component: string) {
  const context = React.useContext(DialogContext);
  if (!context) {
    throw new Error(`${component} must be used inside Dialog`);
  }
  return context;
}

function Dialog({
  children,
  defaultOpen = false,
  onOpenChange,
  open,
}: {
  children?: React.ReactNode;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  open?: boolean;
}) {
  const modalId = React.useId();
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(defaultOpen);
  const isControlled = open !== undefined;
  const resolvedOpen = isControlled ? open : uncontrolledOpen;

  const setOpen = React.useCallback(
    (nextOpen: boolean) => {
      if (!isControlled) {
        setUncontrolledOpen(nextOpen);
      }
      onOpenChange?.(nextOpen);
    },
    [isControlled, onOpenChange]
  );

  const context = React.useMemo<DialogContextValue>(
    () => ({
      modalId,
      open: resolvedOpen,
      setOpen,
    }),
    [modalId, resolvedOpen, setOpen]
  );

  return <DialogContext.Provider value={context}>{children}</DialogContext.Provider>;
}

type DialogButtonProps = React.ComponentProps<'button'> & {
  asChild?: boolean;
};

function cloneButtonChild(
  children: React.ReactNode,
  props: Omit<DialogButtonProps, 'asChild' | 'children'>,
  onClick: (event: React.MouseEvent<HTMLElement>) => void,
  dataSlot: string
) {
  if (React.isValidElement(children)) {
    const child = children as React.ReactElement<Record<string, unknown>>;
    const childOnClick = child.props.onClick as
      ((event: React.MouseEvent<HTMLElement>) => void) | undefined;

    return React.cloneElement(child, {
      ...props,
      'data-slot': dataSlot,
      onClick: (event: React.MouseEvent<HTMLElement>) => {
        childOnClick?.(event);
        onClick(event);
      },
    });
  }

  return null;
}

function DialogTrigger({ asChild, children, onClick, ...props }: DialogButtonProps) {
  const { setOpen } = useDialogContext('DialogTrigger');
  const handleClick = (event: React.MouseEvent<HTMLElement>) => {
    onClick?.(event as React.MouseEvent<HTMLButtonElement>);
    if (!event.defaultPrevented) {
      setOpen(true);
    }
  };

  if (asChild) {
    return cloneButtonChild(children, props, handleClick, 'dialog-trigger');
  }

  return (
    <button data-slot="dialog-trigger" type="button" onClick={handleClick} {...props}>
      {children}
    </button>
  );
}

function DialogPortal({ children }: { children?: React.ReactNode }) {
  return <>{children}</>;
}

function DialogClose({ asChild, children, onClick, ...props }: DialogButtonProps) {
  const { setOpen } = useDialogContext('DialogClose');
  const handleClick = (event: React.MouseEvent<HTMLElement>) => {
    onClick?.(event as React.MouseEvent<HTMLButtonElement>);
    if (!event.defaultPrevented) {
      setOpen(false);
    }
  };

  if (asChild) {
    return cloneButtonChild(children, props, handleClick, 'dialog-close');
  }

  return (
    <button data-slot="dialog-close" type="button" onClick={handleClick} {...props}>
      {children}
    </button>
  );
}

function DialogOverlay({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="dialog-overlay"
      className={cn('veritas-overlay fixed inset-0 isolate z-50', className)}
      {...props}
    />
  );
}

function DialogContent({
  className,
  children,
  showCloseButton = true,
  ...props
}: React.ComponentPropsWithoutRef<'div'> & {
  children?: React.ReactNode;
  showCloseButton?: boolean;
}) {
  const { modalId, open, setOpen } = useDialogContext('DialogContent');

  return (
    <Modal.Root
      centered
      closeOnEscape
      lockScroll
      opened={open}
      onClose={() => setOpen(false)}
      id={modalId}
      padding={0}
      returnFocus
      size="auto"
      trapFocus
    >
      <Modal.Overlay className="veritas-overlay fixed inset-0 isolate z-50" />
      <Modal.Content
        data-slot="dialog-content"
        className={cn(
          'veritas-overlay-surface grid w-full max-w-[calc(100%-2rem)] gap-4 rounded-xl bg-background p-4 text-sm ring-1 ring-foreground/10 outline-none sm:max-w-sm',
          className
        )}
        {...props}
      >
        <Modal.Body className="contents">
          {children}
          {showCloseButton && (
            <DialogClose asChild>
              <Button variant="ghost" className="absolute top-2 right-2" size="icon-sm">
                <XIcon />
                <span className="sr-only">Close</span>
              </Button>
            </DialogClose>
          )}
        </Modal.Body>
      </Modal.Content>
    </Modal.Root>
  );
}

function DialogHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div data-slot="dialog-header" className={cn('flex flex-col gap-2', className)} {...props} />
  );
}

function DialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}: React.ComponentProps<'div'> & {
  showCloseButton?: boolean;
}) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        '-mx-4 -mb-4 flex flex-col-reverse gap-2 rounded-b-xl border-t bg-muted/50 p-4 sm:flex-row sm:justify-end',
        className
      )}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogClose asChild>
          <Button variant="outline">Close</Button>
        </DialogClose>
      )}
    </div>
  );
}

function DialogTitle({ className, id: _legacyId, ...props }: React.ComponentProps<'h2'>) {
  return (
    <Modal.Title
      data-slot="dialog-title"
      className={cn('text-base leading-none font-medium', className)}
      {...props}
    />
  );
}

function DialogDescription({ className, id, ...props }: React.ComponentProps<'p'>) {
  return (
    <p
      data-slot="dialog-description"
      id={id}
      className={cn(
        'text-sm text-muted-foreground *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-foreground',
        className
      )}
      {...props}
    />
  );
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
};
