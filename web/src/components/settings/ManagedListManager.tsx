import { useState, memo, useEffect } from 'react';
import type { ManagedListItem } from '@veritas-kanban/shared';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../ui/alert-dialog';
import { Trash2, GripVertical, ChevronUp, ChevronDown } from 'lucide-react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

export interface ManagedListManagerProps<T extends ManagedListItem> {
  title: string;
  items: T[];
  isLoading: boolean;
  onCreate: (input: any) => Promise<any>;
  onUpdate: (id: string, patch: any) => Promise<any>;
  onDelete: (id: string) => Promise<any>;
  onReorder: (ids: string[]) => Promise<any>;
  renderExtraFields?: (item: T, onChange: (patch: Partial<T>) => void) => React.ReactNode;
  newItemDefaults?: Partial<T>;
  canDeleteCheck?: (id: string) => Promise<{ allowed: boolean; referenceCount: number; isDefault: boolean }>;
}

interface SortableItemProps<T extends ManagedListItem> {
  item: T;
  index: number;
  totalItems: number;
  onUpdate: (id: string, patch: any) => Promise<any>;
  onDelete: (id: string) => Promise<any>;
  onMoveUp: (index: number) => void;
  onMoveDown: (index: number) => void;
  renderExtraFields?: (item: T, onChange: (patch: Partial<T>) => void) => React.ReactNode;
  canDeleteCheck?: (id: string) => Promise<{ allowed: boolean; referenceCount: number; isDefault: boolean }>;
}

const SortableItem = memo(function SortableItem<T extends ManagedListItem>({
  item,
  index,
  totalItems,
  onUpdate,
  onDelete,
  onMoveUp,
  onMoveDown,
  renderExtraFields,
  canDeleteCheck,
}: SortableItemProps<T>) {
  const [isEditing, setIsEditing] = useState(false);
  const [label, setLabel] = useState(item.label);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteInfo, setDeleteInfo] = useState<{ allowed: boolean; referenceCount: number; isDefault: boolean } | null>(null);

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
  } = useSortable({ id: item.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const handleLabelSave = async () => {
    if (label.trim() && label !== item.label) {
      await onUpdate(item.id, { label });
    }
    setIsEditing(false);
  };

  const handleDeleteClick = async () => {
    if (canDeleteCheck) {
      const info = await canDeleteCheck(item.id);
      setDeleteInfo(info);
      if (!info.allowed) {
        setDeleteDialogOpen(true);
        return;
      }
    }
    setDeleteDialogOpen(true);
  };

  const handleDeleteConfirm = async () => {
    await onDelete(item.id);
    setDeleteDialogOpen(false);
  };

  const handleExtraFieldChange = (patch: Partial<T>) => {
    onUpdate(item.id, patch);
  };

  return (
    <>
      <div
        ref={setNodeRef}
        style={style}
        className="flex items-center gap-1.5 px-2 py-1.5 bg-card border rounded-md mb-1"
      >
        <button
          className="cursor-grab active:cursor-grabbing text-gray-400 hover:text-gray-600 flex-shrink-0"
          aria-label="Drag to reorder"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="h-3.5 w-3.5" />
        </button>

        <div className="flex gap-0.5 flex-shrink-0">
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0"
            onClick={() => onMoveUp(index)}
            disabled={index === 0}
            title="Move up"
            aria-label="Move up"
          >
            <ChevronUp className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0"
            onClick={() => onMoveDown(index)}
            disabled={index === totalItems - 1}
            title="Move down"
            aria-label="Move down"
          >
            <ChevronDown className="h-3.5 w-3.5" />
          </Button>
        </div>

        <div className="flex-1 min-w-0">
          {isEditing ? (
            <Input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              onBlur={handleLabelSave}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleLabelSave();
                if (e.key === 'Escape') {
                  setLabel(item.label);
                  setIsEditing(false);
                }
              }}
              autoFocus
              className="h-7 text-sm"
            />
          ) : (
            <div
              className="cursor-pointer hover:bg-muted/50 px-1.5 py-0.5 rounded text-sm"
              onClick={() => setIsEditing(true)}
            >
              {item.label}
              {item.isHidden && (
                <span className="ml-2 text-xs text-muted-foreground">(hidden)</span>
              )}
            </div>
          )}

          {renderExtraFields && renderExtraFields(item, handleExtraFieldChange)}
        </div>

        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0 flex-shrink-0"
          onClick={handleDeleteClick}
          title={`Delete ${item.label}`}
          aria-label={`Delete ${item.label}`}
        >
          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
        </Button>
      </div>

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {deleteInfo && !deleteInfo.allowed ? 'Cannot Delete' : 'Delete Item?'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {deleteInfo && deleteInfo.referenceCount > 0 && !deleteInfo.allowed ? (
                <span>
                  &quot;{item.label}&quot; is used by {deleteInfo.referenceCount} task(s). 
                  Remove or reassign those tasks first before deleting this item.
                </span>
              ) : (
                <span>Are you sure you want to delete &quot;{item.label}&quot;? This action cannot be undone.</span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            {(!deleteInfo || deleteInfo.allowed) && (
              <AlertDialogAction
                onClick={handleDeleteConfirm}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                Delete
              </AlertDialogAction>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}) as <T extends ManagedListItem>(props: SortableItemProps<T>) => React.JSX.Element;

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
  const [localItems, setLocalItems] = useState(items);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  // Sync local state with incoming items
  useEffect(() => {
    setLocalItems(items);
  }, [items]);

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      const oldIndex = localItems.findIndex((item) => item.id === active.id);
      const newIndex = localItems.findIndex((item) => item.id === over.id);

      const reordered = arrayMove(localItems, oldIndex, newIndex);
      const orderedIds = reordered.map((item) => item.id);

      // Optimistic update
      setLocalItems(reordered);

      // Fire onReorder in background
      onReorder(orderedIds).catch((error) => {
        // Rollback on error
        console.error('Failed to reorder items:', error);
        setLocalItems(items);
      });
    }
  };

  const handleCreate = async () => {
    if (!newItemLabel.trim()) return;

    setIsCreating(true);
    try {
      await onCreate({
        label: newItemLabel.trim(),
        ...newItemDefaults,
      });
      setNewItemLabel('');
    } finally {
      setIsCreating(false);
    }
  };

  const handleMoveUp = (index: number) => {
    if (index === 0) return;
    const reordered = arrayMove(localItems, index, index - 1);
    const orderedIds = reordered.map((item) => item.id);
    setLocalItems(reordered);
    onReorder(orderedIds).catch((error) => {
      console.error('Failed to reorder items:', error);
      setLocalItems(items);
    });
  };

  const handleMoveDown = (index: number) => {
    if (index === localItems.length - 1) return;
    const reordered = arrayMove(localItems, index, index + 1);
    const orderedIds = reordered.map((item) => item.id);
    setLocalItems(reordered);
    onReorder(orderedIds).catch((error) => {
      console.error('Failed to reorder items:', error);
      setLocalItems(items);
    });
  };

  if (isLoading) {
    return <div className="text-sm text-muted-foreground">Loading {title.toLowerCase()}...</div>;
  }

  return (
    <div className="space-y-2">
      {title && <h3 className="text-sm font-semibold">{title}</h3>}

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={localItems.map((item) => item.id)}
          strategy={verticalListSortingStrategy}
        >
          {localItems.map((item, index) => (
            <SortableItem
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
        <Input
          placeholder="New item name..."
          value={newItemLabel}
          onChange={(e) => setNewItemLabel(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleCreate();
          }}
          disabled={isCreating}
          className="h-8 text-sm"
        />
        <Button size="sm" onClick={handleCreate} disabled={!newItemLabel.trim() || isCreating}>
          Add
        </Button>
      </div>
    </div>
  );
}
