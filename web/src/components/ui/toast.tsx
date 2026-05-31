import * as React from 'react';
import { Notification } from '@mantine/core';
import { cn } from '@/lib/utils';

function ToastProvider({ children }: { children?: React.ReactNode }) {
  return <>{children}</>;
}

const ToastViewport = React.forwardRef<HTMLDivElement, React.ComponentPropsWithoutRef<'div'>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      data-slot="toast-viewport"
      className={cn('fixed right-4 bottom-4 z-[100] hidden', className)}
      {...props}
    />
  )
);
ToastViewport.displayName = 'ToastViewport';

const Toast = React.forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<'div'> & {
    variant?: 'default' | 'destructive';
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
    duration?: number;
  }
>(
  (
    {
      className,
      variant = 'default',
      open: _open,
      onOpenChange: _onOpenChange,
      duration: _duration,
      ...props
    },
    ref
  ) => {
    return (
      <Notification
        ref={ref}
        data-slot="toast"
        color={variant === 'destructive' ? 'red' : 'veritas'}
        className={cn('pointer-events-auto', className)}
        {...props}
      />
    );
  }
);
Toast.displayName = 'Toast';

const ToastAction = React.forwardRef<HTMLButtonElement, React.ComponentPropsWithoutRef<'button'>>(
  ({ className, ...props }, ref) => (
    <button
      ref={ref}
      data-slot="toast-action"
      className={cn(
        'inline-flex h-8 shrink-0 items-center justify-center rounded-md border bg-transparent px-3 text-sm font-medium transition-colors hover:bg-secondary focus:outline-none focus:ring-2 focus:ring-ring disabled:pointer-events-none disabled:opacity-50',
        className
      )}
      {...props}
    />
  )
);
ToastAction.displayName = 'ToastAction';

const ToastClose = React.forwardRef<HTMLButtonElement, React.ComponentPropsWithoutRef<'button'>>(
  ({ className, ...props }, ref) => (
    <button
      ref={ref}
      className={cn(
        'absolute right-2 top-2 rounded-md p-1 text-foreground/50 opacity-0 transition-opacity hover:text-foreground focus:opacity-100 focus:outline-none focus:ring-2 group-hover:opacity-100 group-[.destructive]:text-red-300 group-[.destructive]:hover:text-red-50 group-[.destructive]:focus:ring-red-400 group-[.destructive]:focus:ring-offset-red-600',
        className
      )}
      data-slot="toast-close"
      type="button"
      {...props}
    />
  )
);
ToastClose.displayName = 'ToastClose';

const ToastTitle = React.forwardRef<HTMLDivElement, React.ComponentPropsWithoutRef<'div'>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      data-slot="toast-title"
      className={cn('text-sm font-semibold', className)}
      {...props}
    />
  )
);
ToastTitle.displayName = 'ToastTitle';

const ToastDescription = React.forwardRef<HTMLDivElement, React.ComponentPropsWithoutRef<'div'>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      data-slot="toast-description"
      className={cn('text-sm opacity-90', className)}
      {...props}
    />
  )
);
ToastDescription.displayName = 'ToastDescription';

type ToastProps = React.ComponentPropsWithoutRef<typeof Toast>;

type ToastActionElement = React.ReactElement<typeof ToastAction>;

export {
  type ToastProps,
  type ToastActionElement,
  ToastProvider,
  ToastViewport,
  Toast,
  ToastTitle,
  ToastDescription,
  ToastClose,
  ToastAction,
};
