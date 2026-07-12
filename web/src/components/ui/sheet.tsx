'use client';

import { Drawer } from '@mantine/core';
import { XIcon } from 'lucide-react';
import * as React from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type SheetSide = 'top' | 'right' | 'bottom' | 'left';

type SheetContextValue = {
  open: boolean;
  setOpen: (open: boolean) => void;
  sheetId: string;
};

const SheetContext = React.createContext<SheetContextValue | null>(null);

function useSheetContext(component: string) {
  const context = React.useContext(SheetContext);
  if (!context) {
    throw new Error(`${component} must be used inside Sheet`);
  }
  return context;
}

function Sheet({
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
  const sheetId = React.useId();
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

  const context = React.useMemo<SheetContextValue>(
    () => ({
      open: resolvedOpen,
      setOpen,
      sheetId,
    }),
    [resolvedOpen, setOpen, sheetId]
  );

  return <SheetContext.Provider value={context}>{children}</SheetContext.Provider>;
}

type SheetButtonProps = React.ComponentProps<'button'> & {
  asChild?: boolean;
};

function cloneButtonChild(
  children: React.ReactNode,
  props: Omit<SheetButtonProps, 'asChild' | 'children'>,
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

function SheetTrigger({ asChild, children, onClick, ...props }: SheetButtonProps) {
  const { setOpen } = useSheetContext('SheetTrigger');
  const handleClick = (event: React.MouseEvent<HTMLElement>) => {
    onClick?.(event as React.MouseEvent<HTMLButtonElement>);
    if (!event.defaultPrevented) {
      setOpen(true);
    }
  };

  if (asChild) {
    return cloneButtonChild(children, props, handleClick, 'sheet-trigger');
  }

  return (
    <button data-slot="sheet-trigger" type="button" onClick={handleClick} {...props}>
      {children}
    </button>
  );
}

function SheetClose({ asChild, children, onClick, ...props }: SheetButtonProps) {
  const { setOpen } = useSheetContext('SheetClose');
  const handleClick = (event: React.MouseEvent<HTMLElement>) => {
    onClick?.(event as React.MouseEvent<HTMLButtonElement>);
    if (!event.defaultPrevented) {
      setOpen(false);
    }
  };

  if (asChild) {
    return cloneButtonChild(children, props, handleClick, 'sheet-close');
  }

  return (
    <button data-slot="sheet-close" type="button" onClick={handleClick} {...props}>
      {children}
    </button>
  );
}

function SheetContent({
  className,
  children,
  side = 'right',
  showCloseButton = true,
  ...props
}: React.ComponentPropsWithoutRef<'div'> & {
  children?: React.ReactNode;
  side?: SheetSide;
  showCloseButton?: boolean;
}) {
  const { open, setOpen, sheetId } = useSheetContext('SheetContent');

  return (
    <Drawer.Root
      closeOnEscape
      id={sheetId}
      lockScroll
      onClose={() => setOpen(false)}
      opened={open}
      position={side}
      returnFocus
      size="auto"
      trapFocus
    >
      <Drawer.Overlay className="veritas-overlay fixed inset-0 z-50" />
      <Drawer.Content
        data-side={side}
        data-slot="sheet-content"
        className={cn(
          'veritas-overlay-surface flex flex-col gap-4 bg-background bg-clip-padding text-sm shadow-lg data-[side=bottom]:h-auto data-[side=bottom]:border-t data-[side=left]:h-full data-[side=left]:w-3/4 data-[side=left]:border-r data-[side=right]:h-full data-[side=right]:w-3/4 data-[side=right]:border-l data-[side=top]:h-auto data-[side=top]:border-b data-[side=left]:sm:max-w-sm data-[side=right]:sm:max-w-sm',
          className
        )}
        {...props}
      >
        <Drawer.Body className="contents">
          {children}
          {showCloseButton && (
            <SheetClose asChild>
              <Button variant="ghost" className="absolute top-3 right-3" size="icon-sm">
                <XIcon />
                <span className="sr-only">Close</span>
              </Button>
            </SheetClose>
          )}
        </Drawer.Body>
      </Drawer.Content>
    </Drawer.Root>
  );
}

function SheetHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="sheet-header"
      className={cn('flex flex-col gap-0.5 p-4', className)}
      {...props}
    />
  );
}

function SheetFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="sheet-footer"
      className={cn('mt-auto flex flex-col gap-2 p-4', className)}
      {...props}
    />
  );
}

function SheetTitle({ className, id: _legacyId, ...props }: React.ComponentProps<'h2'>) {
  return (
    <Drawer.Title
      data-slot="sheet-title"
      className={cn('text-base font-medium text-foreground', className)}
      {...props}
    />
  );
}

function SheetDescription({ className, id, ...props }: React.ComponentProps<'p'>) {
  return (
    <p
      data-slot="sheet-description"
      id={id}
      className={cn('text-sm text-muted-foreground', className)}
      {...props}
    />
  );
}

export {
  Sheet,
  SheetTrigger,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetFooter,
  SheetTitle,
  SheetDescription,
};
