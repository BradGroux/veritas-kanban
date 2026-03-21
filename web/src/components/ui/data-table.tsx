import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface DataTableColumn<T> {
  key: string;
  header: ReactNode;
  className?: string;
  cell: (row: T) => ReactNode;
}

interface DataTableProps<T> {
  columns: DataTableColumn<T>[];
  data: T[];
  emptyMessage?: string;
  rowKey: (row: T) => string;
}

export function DataTable<T>({
  columns,
  data,
  emptyMessage = 'No rows found.',
  rowKey,
}: DataTableProps<T>) {
  return (
    <div className="overflow-hidden rounded-lg border bg-card">
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-muted/40">
            <tr>
              {columns.map((column) => (
                <th
                  key={column.key}
                  className={cn(
                    'px-4 py-3 text-left font-medium text-muted-foreground',
                    column.className
                  )}
                >
                  {column.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length}
                  className="px-4 py-10 text-center text-muted-foreground"
                >
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              data.map((row) => (
                <tr key={rowKey(row)} className="border-t align-top">
                  {columns.map((column) => (
                    <td key={column.key} className={cn('px-4 py-3', column.className)}>
                      {column.cell(row)}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
