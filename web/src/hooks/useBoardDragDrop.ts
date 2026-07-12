import { useState, useCallback, useMemo, useRef } from 'react';
import {
  Announcements,
  CollisionDetection,
  DragCancelEvent,
  DragEndEvent,
  DragOverEvent,
  DragStartEvent,
  KeyboardCoordinateGetter,
  KeyboardSensor,
  PointerSensor,
  ScreenReaderInstructions,
  pointerWithin,
  rectIntersection,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { arrayMove, sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import type { BoardColumnConfig, Task, TaskStatus } from '@veritas-kanban/shared';

interface UseBoardDragDropOptions {
  tasks: Task[];
  tasksByStatus: Record<string, Task[]>;
  columns: BoardColumnConfig[];
  onStatusChange: (taskId: string, status: TaskStatus) => Promise<void>;
  onReorder: (taskIds: string[]) => Promise<void>;
  announce: (message: string) => void;
}

interface UseBoardDragDropReturn {
  activeTask: Task | null;
  isDragActive: boolean;
  /** Use this for rendering columns — reflects real-time drag state */
  liveTasksByStatus: Record<string, Task[]>;
  sensors: ReturnType<typeof useSensors>;
  collisionDetection: CollisionDetection;
  announcements: Announcements;
  screenReaderInstructions: ScreenReaderInstructions;
  handleDragStart: (event: DragStartEvent) => void;
  handleDragOver: (event: DragOverEvent) => void;
  handleDragEnd: (event: DragEndEvent) => Promise<void>;
  handleDragCancel: (event: DragCancelEvent) => void;
}

const screenReaderInstructions: ScreenReaderInstructions = {
  draggable:
    'To pick up a task, press Space. While dragging, use the arrow keys to move it within or between columns. Press Space again to drop it, or press Escape to cancel.',
};

export function createBoardKeyboardCoordinates(columnIds: string[]): KeyboardCoordinateGetter {
  return (event, args) => {
    const isHorizontal = event.code === 'ArrowLeft' || event.code === 'ArrowRight';
    const isVertical = event.code === 'ArrowUp' || event.code === 'ArrowDown';
    if (!isHorizontal && !isVertical) {
      return sortableKeyboardCoordinates(event, args);
    }

    if (isVertical) {
      const sortable =
        args.context.over?.data.current?.sortable ?? args.context.active?.data.current?.sortable;
      const index = typeof sortable?.index === 'number' ? sortable.index : -1;
      const itemCount = Array.isArray(sortable?.items) ? sortable.items.length : 0;
      const canSortWithinColumn =
        (event.code === 'ArrowUp' && index > 0) ||
        (event.code === 'ArrowDown' && index >= 0 && index < itemCount - 1);
      if (canSortWithinColumn) return sortableKeyboardCoordinates(event, args);
    }

    const { collisionRect, droppableRects } = args.context;
    if (!collisionRect) return sortableKeyboardCoordinates(event, args);

    const columnRects = columnIds
      .map((id) => ({ id, rect: droppableRects.get(id) }))
      .filter((entry): entry is { id: string; rect: NonNullable<typeof entry.rect> } =>
        Boolean(entry.rect)
      );
    if (columnRects.length === 0) return sortableKeyboardCoordinates(event, args);

    const collisionCenter = {
      x: collisionRect.left + collisionRect.width / 2,
      y: collisionRect.top + collisionRect.height / 2,
    };
    let currentIndex = columnRects.findIndex(
      ({ rect }) =>
        collisionCenter.x >= rect.left &&
        collisionCenter.x <= rect.right &&
        collisionCenter.y >= rect.top &&
        collisionCenter.y <= rect.bottom
    );
    if (currentIndex < 0) {
      currentIndex = columnRects.reduce((closestIndex, { rect }, index) => {
        const distance = Math.hypot(
          rect.left + rect.width / 2 - collisionCenter.x,
          rect.top + rect.height / 2 - collisionCenter.y
        );
        const closestRect = columnRects[closestIndex].rect;
        const closestDistance = Math.hypot(
          closestRect.left + closestRect.width / 2 - collisionCenter.x,
          closestRect.top + closestRect.height / 2 - collisionCenter.y
        );
        return distance < closestDistance ? index : closestIndex;
      }, 0);
    }

    const currentRect = columnRects[currentIndex].rect;
    const currentCenter = {
      x: currentRect.left + currentRect.width / 2,
      y: currentRect.top + currentRect.height / 2,
    };
    const candidates = columnRects.filter(({ rect }, index) => {
      if (index === currentIndex) return false;
      const center = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      if (event.code === 'ArrowLeft') return center.x < currentCenter.x;
      if (event.code === 'ArrowRight') return center.x > currentCenter.x;
      if (event.code === 'ArrowUp') return center.y < currentCenter.y;
      return center.y > currentCenter.y;
    });
    const target = candidates.sort((a, b) => {
      const score = ({ rect }: (typeof candidates)[number]) => {
        const deltaX = Math.abs(rect.left + rect.width / 2 - currentCenter.x);
        const deltaY = Math.abs(rect.top + rect.height / 2 - currentCenter.y);
        return isHorizontal ? deltaX + deltaY * 0.5 : deltaY + deltaX * 0.5;
      };
      return score(a) - score(b);
    })[0]?.rect;
    if (!target) return undefined;

    event.preventDefault();
    return {
      x: isHorizontal
        ? target.left + Math.max(0, (target.width - collisionRect.width) / 2)
        : Math.max(
            target.left,
            Math.min(args.currentCoordinates.x, target.right - collisionRect.width)
          ),
      y: isVertical
        ? target.top
        : Math.max(
            target.top,
            Math.min(args.currentCoordinates.y, target.bottom - collisionRect.height)
          ),
    };
  };
}

export function useBoardDragDrop({
  tasks,
  tasksByStatus,
  columns,
  onStatusChange,
  onReorder,
  announce,
}: UseBoardDragDropOptions): UseBoardDragDropReturn {
  const [activeTask, setActiveTask] = useState<Task | null>(null);
  // Local copy of tasksByStatus that updates in real-time during drag.
  // null = not dragging, use server state; non-null = mid-drag, use local state
  const [dragState, setDragState] = useState<Record<string, Task[]> | null>(null);
  const activeIdRef = useRef<string | null>(null);
  const columnIds = useMemo(() => columns.map((column) => column.id), [columns]);
  const keyboardCoordinateGetter = useMemo(
    () => createBoardKeyboardCoordinates(columnIds),
    [columnIds]
  );

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: keyboardCoordinateGetter,
    })
  );

  // Custom collision detection: pointerWithin for accuracy, rectIntersection as fallback.
  // When over a column, prefer a task collision for precise positioning; fall back to
  // the column droppable for empty areas.
  const collisionDetection: CollisionDetection = useCallback(
    (args) => {
      const pointerCollisions = pointerWithin(args);

      if (pointerCollisions.length > 0) {
        const taskCollision = pointerCollisions.find(
          (c) => !columnIds.includes(c.id as TaskStatus)
        );
        const columnCollision = pointerCollisions.find((c) =>
          columnIds.includes(c.id as TaskStatus)
        );

        if (taskCollision) return [taskCollision];
        if (columnCollision) return [columnCollision];
        return pointerCollisions;
      }

      return rectIntersection(args);
    },
    [columnIds]
  );

  // The live state columns should render from — either mid-drag local state or server state
  const liveTasksByStatus = dragState ?? tasksByStatus;

  const taskTitle = useCallback(
    (taskId: string) => tasks.find((task) => task.id === taskId)?.title ?? taskId,
    [tasks]
  );

  // Find which column a task belongs to in the given state
  const findColumn = useCallback(
    (taskId: string, state: Record<string, Task[]>): TaskStatus | null => {
      for (const col of columns) {
        if (state[col.id]?.some((t: Task) => t.id === taskId)) {
          return col.id;
        }
      }
      return null;
    },
    [columns]
  );

  const describeTaskPosition = useCallback(
    (taskId: string, state: Record<string, Task[]>): string | null => {
      const columnId = findColumn(taskId, state);
      if (!columnId) return null;
      const columnTasks = state[columnId] ?? [];
      const index = columnTasks.findIndex((task) => task.id === taskId);
      if (index < 0) return null;
      const columnTitle = columns.find((column) => column.id === columnId)?.title ?? columnId;
      return `${columnTitle}, position ${index + 1} of ${columnTasks.length}`;
    },
    [columns, findColumn]
  );

  const focusTask = useCallback((taskId: string) => {
    window.setTimeout(() => {
      const taskCard = Array.from(document.querySelectorAll<HTMLElement>('[data-task-id]')).find(
        (element) => element.dataset.taskId === taskId
      );
      taskCard?.focus();
    }, 0);
  }, []);

  const clearDragState = useCallback(
    (taskId: string | null) => {
      setActiveTask(null);
      setDragState(null);
      activeIdRef.current = null;
      if (taskId) focusTask(taskId);
    },
    [focusTask]
  );

  const announcements = useMemo<Announcements>(
    () => ({
      onDragStart: ({ active }) =>
        `Picked up ${taskTitle(String(active.id))}. Use the arrow keys to move, Space to drop, or Escape to cancel.`,
      onDragOver: ({ active, over }) => {
        if (!over) return `${taskTitle(String(active.id))} is no longer over a drop target.`;
        const state = dragState ?? tasksByStatus;
        const overId = String(over.id);
        const activeId = String(active.id);
        if (columnIds.includes(overId as TaskStatus)) {
          const destination = state[overId] ?? [];
          const columnTitle = columns.find((column) => column.id === overId)?.title ?? overId;
          const activeIndex = destination.findIndex((task) => task.id === activeId);
          const position = activeIndex >= 0 ? activeIndex + 1 : destination.length + 1;
          const total = activeIndex >= 0 ? destination.length : destination.length + 1;
          return `${taskTitle(activeId)} is over ${columnTitle}, position ${position} of ${total}.`;
        }
        const position = describeTaskPosition(overId, state);
        return position ? `${taskTitle(activeId)} is over ${position}.` : undefined;
      },
      onDragEnd: ({ active }) => `${taskTitle(String(active.id))} was dropped. Saving move.`,
      onDragCancel: ({ active }) => `${taskTitle(String(active.id))} move canceled.`,
    }),
    [columnIds, columns, describeTaskPosition, dragState, taskTitle, tasksByStatus]
  );

  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      const task = tasks?.find((t) => t.id === event.active.id);
      if (task) {
        setActiveTask(task);
        activeIdRef.current = event.active.id as string;
        // Snapshot current server state into local drag state
        setDragState({ ...tasksByStatus });
      }
    },
    [tasks, tasksByStatus]
  );

  const handleDragOver = useCallback(
    (event: DragOverEvent) => {
      const { active, over } = event;
      if (!over) return;

      const activeId = active.id as string;
      const overId = over.id as string;
      if (activeId === overId) return;

      setDragState((prev) => {
        if (!prev) return prev;

        const activeColumn = findColumn(activeId, prev);
        if (!activeColumn) return prev;

        // Determine destination column
        const isOverColumn = columnIds.includes(overId as TaskStatus);
        const overColumn = isOverColumn ? (overId as TaskStatus) : findColumn(overId, prev);

        if (!overColumn) return prev;

        // Reorder within the same column when hovering over another task.
        const sourceTasks = prev[activeColumn] ?? [];
        const activeIndex = sourceTasks.findIndex((t) => t.id === activeId);
        if (activeIndex === -1) return prev;

        if (activeColumn === overColumn) {
          if (isOverColumn) return prev;

          const overIndex = sourceTasks.findIndex((t) => t.id === overId);
          if (overIndex === -1 || activeIndex === overIndex) return prev;

          return {
            ...prev,
            [activeColumn]: arrayMove(sourceTasks, activeIndex, overIndex),
          };
        }

        // Move the task from source to destination.
        const destTasks = prev[overColumn] ?? [];
        const movedTask = sourceTasks[activeIndex];
        const newSource = [...sourceTasks];
        newSource.splice(activeIndex, 1);

        const newDest = [...destTasks];
        if (isOverColumn) {
          // Dropped on column itself — append to end
          newDest.push(movedTask);
        } else {
          // Dropped on a task — insert at that position
          const overIndex = newDest.findIndex((t) => t.id === overId);
          if (overIndex >= 0) {
            newDest.splice(overIndex, 0, movedTask);
          } else {
            newDest.push(movedTask);
          }
        }

        return {
          ...prev,
          [activeColumn]: newSource,
          [overColumn]: newDest,
        };
      });
    },
    [columnIds, findColumn]
  );

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      const { active, over } = event;
      const finalState = dragState;
      const activeId = active.id as string;
      const originalPosition = describeTaskPosition(activeId, tasksByStatus);

      clearDragState(activeId);

      if (!over || !finalState) return;

      const overId = over.id as string;

      // Find where the task ended up in our local drag state
      const originalColumn = findColumn(activeId, tasksByStatus);
      const finalColumn = findColumn(activeId, finalState);

      if (!originalColumn || !finalColumn) return;

      if (originalColumn === finalColumn && !columnIds.includes(overId as TaskStatus)) {
        // Same column — check for reorder
        const columnTasks = finalState[finalColumn] ?? [];
        const origColumnTasks = tasksByStatus[originalColumn] ?? [];
        const oldIndex = origColumnTasks.findIndex((t: Task) => t.id === activeId);
        const newIndex = columnTasks.findIndex((t: Task) => t.id === activeId);

        if (oldIndex !== newIndex && oldIndex >= 0 && newIndex >= 0) {
          const reordered = arrayMove(origColumnTasks, oldIndex, newIndex);
          try {
            await onReorder(reordered.map((t: Task) => t.id));
            announce(
              `${taskTitle(activeId)} moved to ${describeTaskPosition(activeId, finalState)}`
            );
          } catch {
            announce(`Move failed. ${taskTitle(activeId)} returned to ${originalPosition}`);
          }
        }
      } else if (originalColumn !== finalColumn) {
        let statusChanged = false;
        try {
          await onStatusChange(activeId, finalColumn);
          statusChanged = true;
          const newOrder = (finalState[finalColumn] ?? []).map((t: Task) => t.id);
          await onReorder(newOrder);
          announce(`${taskTitle(activeId)} moved to ${describeTaskPosition(activeId, finalState)}`);
        } catch {
          if (statusChanged) {
            try {
              await onStatusChange(activeId, originalColumn);
            } catch {
              const finalColumnTitle =
                columns.find((column) => column.id === finalColumn)?.title ?? finalColumn;
              announce(
                `Move partially failed. ${taskTitle(activeId)} may still be in ${finalColumnTitle} because automatic rollback failed; refresh the board before trying again`
              );
              focusTask(activeId);
              return;
            }
          }
          announce(`Move failed. ${taskTitle(activeId)} returned to ${originalPosition}`);
        }
      }

      // Status changes can remount the card in another column. Restore focus only
      // after the commit or rollback has updated the task cache.
      focusTask(activeId);
    },
    [
      announce,
      clearDragState,
      columnIds,
      columns,
      describeTaskPosition,
      dragState,
      findColumn,
      focusTask,
      onReorder,
      onStatusChange,
      taskTitle,
      tasksByStatus,
    ]
  );

  const handleDragCancel = useCallback(
    (_event: DragCancelEvent) => {
      const activeId = activeIdRef.current;
      const position = activeId ? describeTaskPosition(activeId, tasksByStatus) : null;
      clearDragState(activeId);
      if (activeId && position) {
        announce(`Move canceled. ${taskTitle(activeId)} returned to ${position}`);
      }
    },
    [announce, clearDragState, describeTaskPosition, taskTitle, tasksByStatus]
  );

  return {
    activeTask,
    isDragActive: activeTask !== null,
    liveTasksByStatus,
    sensors,
    collisionDetection,
    announcements,
    screenReaderInstructions,
    handleDragStart,
    handleDragOver,
    handleDragEnd,
    handleDragCancel,
  };
}
