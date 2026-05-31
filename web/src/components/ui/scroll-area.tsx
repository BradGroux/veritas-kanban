'use client';

import * as React from 'react';
import {
  ScrollArea as MantineScrollArea,
  type ScrollAreaProps as MantineScrollAreaProps,
} from '@mantine/core';

import { cn } from '@/lib/utils';

function ScrollArea({
  className,
  children,
  ...props
}: React.ComponentProps<'div'> & MantineScrollAreaProps) {
  return (
    <MantineScrollArea
      data-slot="scroll-area"
      type="auto"
      className={cn('relative', className)}
      {...props}
    >
      {children}
    </MantineScrollArea>
  );
}

function ScrollBar({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="scroll-area-scrollbar" className={cn('hidden', className)} {...props} />;
}

export { ScrollArea, ScrollBar };
