'use client';

import { Modal } from '@mantine/core';
import * as React from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type AlertDialogContextValue = {
  open: boolean;
  setOpen: (open: boolean) => void;
  modalId: string;
};

const AlertDialogContext = React.createContext<AlertDialogContextValue | null>(null);

function useAlertDialogContext(component: string) {
  const context = React.useContext(AlertDialogContext);
  if (!context) {
    throw new Error(`${component} must be used inside AlertDialog`);
  }
  return context;
}

function AlertDialog({
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

  const context = React.useMemo<AlertDialogContextValue>(
    () => ({
      modalId,
      open: resolvedOpen,
      setOpen,
    }),
    [modalId, resolvedOpen, setOpen]
  );

  return <AlertDialogContext.Provider value={context}>{children}</AlertDialogContext.Provider>;
}

type AlertDialogButtonProps = React.ComponentProps<'button'> & {
  asChild?: boolean;
};

function cloneButtonChild(
  children: React.ReactNode,
  props: Omit<AlertDialogButtonProps, 'asChild' | 'children'>,
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

function AlertDialogTrigger({ asChild, children, onClick, ...props }: AlertDialogButtonProps) {
  const { setOpen } = useAlertDialogContext('AlertDialogTrigger');
  const handleClick = (event: React.MouseEvent<HTMLElement>) => {
    onClick?.(event as React.MouseEvent<HTMLButtonElement>);
    if (!event.defaultPrevented) {
      setOpen(true);
    }
  };

  if (asChild) {
    return cloneButtonChild(children, props, handleClick, 'alert-dialog-trigger');
  }

  return (
    <button data-slot="alert-dialog-trigger" type="button" onClick={handleClick} {...props}>
      {children}
    </button>
  );
}

function AlertDialogPortal({ children }: { children?: React.ReactNode }) {
  return <>{children}</>;
}

function AlertDialogOverlay({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="alert-dialog-overlay"
      className={cn('veritas-overlay fixed inset-0 z-50', className)}
      {...props}
    />
  );
}

function AlertDialogContent({
  children,
  className,
  size = 'default',
  ...props
}: React.ComponentPropsWithoutRef<'div'> & {
  children?: React.ReactNode;
  size?: 'default' | 'sm';
}) {
  const { modalId, open, setOpen } = useAlertDialogContext('AlertDialogContent');

  return (
    <Modal.Root
      centered
      closeOnClickOutside={false}
      closeOnEscape
      id={modalId}
      lockScroll
      onClose={() => setOpen(false)}
      opened={open}
      padding={0}
      returnFocus
      size="auto"
      trapFocus
    >
      <Modal.Overlay className="veritas-overlay fixed inset-0 z-50" />
      <Modal.Content
        data-size={size}
        data-slot="alert-dialog-content"
        className={cn(
          'veritas-overlay-surface group/alert-dialog-content grid w-full gap-4 rounded-xl bg-background p-4 ring-1 ring-foreground/10 outline-none data-[size=default]:max-w-xs data-[size=sm]:max-w-xs data-[size=default]:sm:max-w-sm',
          className
        )}
        {...props}
      >
        <Modal.Body className="contents">{children}</Modal.Body>
      </Modal.Content>
    </Modal.Root>
  );
}

function AlertDialogHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="alert-dialog-header"
      className={cn(
        'grid grid-rows-[auto_1fr] place-items-center gap-1.5 text-center has-data-[slot=alert-dialog-media]:grid-rows-[auto_auto_1fr] has-data-[slot=alert-dialog-media]:gap-x-4 sm:group-data-[size=default]/alert-dialog-content:place-items-start sm:group-data-[size=default]/alert-dialog-content:text-left sm:group-data-[size=default]/alert-dialog-content:has-data-[slot=alert-dialog-media]:grid-rows-[auto_1fr]',
        className
      )}
      {...props}
    />
  );
}

function AlertDialogFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="alert-dialog-footer"
      className={cn(
        '-mx-4 -mb-4 flex flex-col-reverse gap-2 rounded-b-xl border-t bg-muted/50 p-4 group-data-[size=sm]/alert-dialog-content:grid group-data-[size=sm]/alert-dialog-content:grid-cols-2 sm:flex-row sm:justify-end',
        className
      )}
      {...props}
    />
  );
}

function AlertDialogMedia({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="alert-dialog-media"
      className={cn(
        "mb-2 inline-flex size-10 items-center justify-center rounded-md bg-muted sm:group-data-[size=default]/alert-dialog-content:row-span-2 *:[svg:not([class*='size-'])]:size-6",
        className
      )}
      {...props}
    />
  );
}

function AlertDialogTitle({ className, id: _legacyId, ...props }: React.ComponentProps<'h2'>) {
  return (
    <Modal.Title
      data-slot="alert-dialog-title"
      className={cn(
        'text-base font-medium sm:group-data-[size=default]/alert-dialog-content:group-has-data-[slot=alert-dialog-media]/alert-dialog-content:col-start-2',
        className
      )}
      {...props}
    />
  );
}

function AlertDialogDescription({ className, id, ...props }: React.ComponentProps<'p'>) {
  return (
    <p
      data-slot="alert-dialog-description"
      id={id}
      className={cn(
        'text-sm text-balance text-muted-foreground md:text-pretty *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-foreground',
        className
      )}
      {...props}
    />
  );
}

function AlertDialogAction({
  className,
  onClick,
  variant = 'default',
  size = 'default',
  ...props
}: React.ComponentProps<'button'> & Pick<React.ComponentProps<typeof Button>, 'variant' | 'size'>) {
  const { setOpen } = useAlertDialogContext('AlertDialogAction');
  const handleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    onClick?.(event);
    if (!event.defaultPrevented) {
      setOpen(false);
    }
  };

  return (
    <Button
      data-slot="alert-dialog-action"
      variant={variant}
      size={size}
      className={cn(className)}
      onClick={handleClick}
      {...props}
    />
  );
}

function AlertDialogCancel({
  className,
  onClick,
  variant = 'outline',
  size = 'default',
  ...props
}: React.ComponentProps<'button'> & Pick<React.ComponentProps<typeof Button>, 'variant' | 'size'>) {
  const { setOpen } = useAlertDialogContext('AlertDialogCancel');
  const handleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    onClick?.(event);
    if (!event.defaultPrevented) {
      setOpen(false);
    }
  };

  return (
    <Button
      data-slot="alert-dialog-cancel"
      variant={variant}
      size={size}
      className={cn(className)}
      onClick={handleClick}
      {...props}
    />
  );
}

export {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogOverlay,
  AlertDialogPortal,
  AlertDialogTitle,
  AlertDialogTrigger,
};
