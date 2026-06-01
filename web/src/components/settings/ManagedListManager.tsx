import { useState } from 'react';
import type { ManagedListItem } from '@veritas-kanban/shared';
import { Button, TextInput } from '@mantine/core';
import { DndContext, closestCenter } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { useSortableList } from '@/hooks/useSortableList';
import { SortableListItem } from './SortableListItem';

type ManagedListCreateInput<T extends ManagedListItem> = Partial<T> & Pick<T, 'label'>;
type ManagedListPatch<T extends ManagedListItem> = Partial<T> | Pick<ManagedListItem, 'label'>;

export interface ManagedListManagerProps<T extends ManagedListItem> {
  title: string;
  items: T[];
  isLoading: boolean;
  onCreate: (input: ManagedListCreateInput<T>) => Promise<unknown>;
  onUpdate: (id: string, patch: ManagedListPatch<T>) => Promise<unknown>;
  onDelete: (id: string) => Promise<unknown>;
  onReorder: (ids: string[]) => Promise<unknown>;
  renderExtraFields?: (item: T, onChange: (patch: Partial<T>) => void) => React.ReactNode;
  newItemDefaults?: Partial<T>;
  canDeleteCheck?: (id: string) => Promise<{
    allowed: boolean;
    referenceCount: number;
    isDefault: boolean;
  }>;
}

export function ManagedListManager<T extends ManagedListItem>({
  title,
  items,
  isLoading,
  onCreate,
  onUpdate,
  onDelete,
  onReorder,
  renderExtraFields,
  newItemDefaults,
  canDeleteCheck,
}: ManagedListManagerProps<T>) {
  const [newItemLabel, setNewItemLabel] = useState('');
  const [isCreating, setIsCreating] = useState(false);

  const { localItems, sensors, handleDragEnd, handleMoveUp, handleMoveDown } = useSortableList({
    items,
    onReorder,
  });

  const handleCreate = async () => {
    if (!newItemLabel.trim()) return;

    setIsCreating(true);
    try {
      const input = {
        ...newItemDefaults,
        label: newItemLabel.trim(),
      } as ManagedListCreateInput<T>;
      await onCreate(input);
      setNewItemLabel('');
    } finally {
      setIsCreating(false);
    }
  };

  if (isLoading) {
    return <div className="text-sm text-muted-foreground">Loading {title.toLowerCase()}...</div>;
  }

  return (
    <div className="space-y-2">
      {title && <h3 className="text-sm font-semibold">{title}</h3>}

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext
          items={localItems.map((item) => item.id)}
          strategy={verticalListSortingStrategy}
        >
          {localItems.map((item, index) => (
            <SortableListItem
              key={item.id}
              item={item}
              index={index}
              totalItems={localItems.length}
              onUpdate={onUpdate}
              onDelete={onDelete}
              onMoveUp={handleMoveUp}
              onMoveDown={handleMoveDown}
              renderExtraFields={renderExtraFields}
              canDeleteCheck={canDeleteCheck}
            />
          ))}
        </SortableContext>
      </DndContext>

      <div className="flex gap-2">
        <TextInput
          placeholder="New item name..."
          value={newItemLabel}
          onChange={(e) => setNewItemLabel(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleCreate();
          }}
          disabled={isCreating}
          size="xs"
          radius="md"
          className="flex-1"
        />
        <Button
          size="xs"
          radius="md"
          onClick={handleCreate}
          disabled={!newItemLabel.trim() || isCreating}
        >
          Add
        </Button>
      </div>
    </div>
  );
}
