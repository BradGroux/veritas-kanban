import { Skeleton } from '@/components/ui/skeleton';
import type { TaskStatus } from '@veritas-kanban/shared';

interface Column {
  id: TaskStatus;
  title: string;
}

interface BoardLoadingSkeletonProps {
  columns: Column[];
}

export function BoardLoadingSkeleton({ columns }: BoardLoadingSkeletonProps) {
  return (
    <div className="grid grid-cols-5 gap-4">
      {columns.map((column) => (
        <div
          key={column.id}
          className="flex flex-col rounded-lg bg-muted/50 border-t-2 border-t-muted-foreground/20"
        >
          <div className="flex items-center justify-between px-3 py-2">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-5 w-6 rounded-full" />
          </div>
          <div className="flex-1 p-2 space-y-2 min-h-[calc(100vh-200px)]">
            {[1, 2, 3].map((i) => (
              <div key={i} className="bg-card border border-border rounded-md p-3 space-y-2">
                <div className="flex items-start gap-2">
                  <Skeleton className="h-4 w-4 mt-0.5" />
                  <div className="flex-1 space-y-1">
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-3 w-2/3" />
                  </div>
                </div>
                <div className="flex gap-2">
                  <Skeleton className="h-5 w-16 rounded" />
                  <Skeleton className="h-5 w-12 rounded" />
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
