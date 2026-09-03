import { UiIconAction, UiAction } from '@/components/ui/UiVocabulary';
import { SettingsGroup } from '@/components/settings/shared/SettingsLayout';
import { useState, memo } from 'react';
import type { ManagedListItem } from '@veritas-kanban/shared';
import { Group, Modal, Stack, Text, TextInput } from '@mantine/core';
import { Trash2, GripVertical, ChevronUp, ChevronDown } from 'lucide-react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

type ManagedListPatch<T extends ManagedListItem> = Partial<T> | Pick<ManagedListItem, 'label'>;

export interface SortableListItemProps<T extends ManagedListItem> {
  item: T;
  index: number;
  totalItems: number;
  onUpdate: (id: string, patch: ManagedListPatch<T>) => Promise<unknown>;
  onDelete: (id: string) => Promise<unknown>;
  onMoveUp: (index: number) => void;
  onMoveDown: (index: number) => void;
  renderExtraFields?: (item: T, onChange: (patch: Partial<T>) => void) => React.ReactNode;
  canDeleteCheck?: (id: string) => Promise<{
    allowed: boolean;
    referenceCount: number;
    isDefault: boolean;
  }>;
}

export const SortableListItem = memo(function SortableListItem<T extends ManagedListItem>({
  item,
  index,
  totalItems,
  onUpdate,
  onDelete,
  onMoveUp,
  onMoveDown,
  renderExtraFields,
  canDeleteCheck,
}: SortableListItemProps<T>) {
  const [isEditing, setIsEditing] = useState(false);
  const [label, setLabel] = useState(item.label);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteInfo, setDeleteInfo] = useState<{
    allowed: boolean;
    referenceCount: number;
    isDefault: boolean;
  } | null>(null);

  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: item.id });

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
      <SettingsGroup
        data-settings-sortable-row
        ref={setNodeRef}
        style={style}
        className="flex items-center gap-1.5 px-2 py-1.5 mb-1"
      >
        <UiIconAction
          variant="quiet"
          type="button"
          className="cursor-grab active:cursor-grabbing flex-shrink-0"
          aria-label="Drag to reorder"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="h-3.5 w-3.5" />
        </UiIconAction>

        <div className="flex gap-0.5 flex-shrink-0">
          <UiIconAction
            variant="quiet"
            type="button"
            onClick={() => onMoveUp(index)}
            disabled={index === 0}
            title="Move up"
            aria-label="Move up"
          >
            <ChevronUp className="h-3.5 w-3.5" />
          </UiIconAction>
          <UiIconAction
            variant="quiet"
            type="button"
            onClick={() => onMoveDown(index)}
            disabled={index === totalItems - 1}
            title="Move down"
            aria-label="Move down"
          >
            <ChevronDown className="h-3.5 w-3.5" />
          </UiIconAction>
        </div>

        <div className="flex-1 min-w-0">
          {isEditing ? (
            <TextInput
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
              size="xs"
              radius="md"
              aria-label={`Edit ${item.label}`}
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

        <UiIconAction
          variant="destructive"
          type="button"
          className="flex-shrink-0"
          onClick={handleDeleteClick}
          title={`Delete ${item.label}`}
          aria-label={`Delete ${item.label}`}
        >
          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
        </UiIconAction>
      </SettingsGroup>

      <Modal
        opened={deleteDialogOpen}
        onClose={() => setDeleteDialogOpen(false)}
        title={deleteInfo && !deleteInfo.allowed ? 'Cannot Delete' : 'Delete Item?'}
        centered
      >
        <Stack gap="md">
          <Text size="sm" c="dimmed">
            {deleteInfo && deleteInfo.referenceCount > 0 && !deleteInfo.allowed ? (
              <>
                &quot;{item.label}&quot; is used by {deleteInfo.referenceCount} task(s). Remove or
                reassign those tasks first before deleting this item.
              </>
            ) : (
              <>
                Are you sure you want to delete &quot;{item.label}&quot;? This action cannot be
                undone.
              </>
            )}
          </Text>
          <Group justify="flex-end">
            <UiAction variant="quiet" onClick={() => setDeleteDialogOpen(false)}>
              Cancel
            </UiAction>
            {(!deleteInfo || deleteInfo.allowed) && (
              <UiAction variant="destructive" onClick={handleDeleteConfirm}>
                Delete
              </UiAction>
            )}
          </Group>
        </Stack>
      </Modal>
    </>
  );
}) as <T extends ManagedListItem>(props: SortableListItemProps<T>) => React.JSX.Element;
