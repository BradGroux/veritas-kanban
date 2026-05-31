import {
  Skeleton as MantineSkeleton,
  type SkeletonProps as MantineSkeletonProps,
} from '@mantine/core';

import { cn } from '@/lib/utils';

function Skeleton({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <MantineSkeleton
      data-slot="skeleton"
      className={cn('animate-pulse rounded-md bg-muted', className)}
      {...(props as MantineSkeletonProps & React.ComponentProps<'div'>)}
    />
  );
}

export { Skeleton };
