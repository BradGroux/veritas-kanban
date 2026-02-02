import { useState, useCallback, useRef } from 'react';
import {
  CollisionDetection,
  DragEndEvent,
  DragOverEvent,
  DragStartEvent,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  rectIntersection,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { arrayMove, sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import type { Task, TaskStatus } from '@veritas-kanban/shared';

interface UseBoardDragDropOptions {
  tasks: Task[];
  tasksByStatus: Record<TaskStatus, Task[]>;
  columns: { id: TaskStatus; title: string }[];
  onStatusChange: (taskId: string, status: TaskStatus) => void;
  onReorder: (taskIds: string[], onSuccess?: () => void) => void;
}

interface UseBoardDragDropReturn {
  activeTask: Task | null;
  isDragActive: boolean;
  /** Use this for rendering columns — reflects real-time drag state */
  liveTasksByStatus: Record<TaskStatus, Task[]>;
  sensors: ReturnType<typeof useSensors>;
  collisionDetection: CollisionDetection;
  handleDragStart: (event: DragStartEvent) => void;
  handleDragOver: (event: DragOverEvent) => void;
  handleDragEnd: (event: DragEndEvent) => void;
}

export function useBoardDragDrop({
  tasks,
  tasksByStatus,
  columns,
  onStatusChange,
  onReorder,
}: UseBoardDragDropOptions): UseBoardDragDropReturn {
  const [activeTask, setActiveTask] = useState<Task | null>(null);
  // Local copy of tasksByStatus that updates in real-time during drag.
  // null = not dragging, use server state; non-null = mid-drag, use local state
  const [dragState, setDragState] = useState<Record<TaskStatus, Task[]> | null>(null);
  const activeIdRef = useRef<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const columnIds = columns.map((c) => c.id);

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

  // Find which column a task belongs to in the given state
  const findColumn = useCallback(
    (taskId: string, state: Record<TaskStatus, Task[]>): TaskStatus | null => {
      for (const col of columns) {
        if (state[col.id]?.some((t: Task) => t.id === taskId)) {
          return col.id;
        }
      }
      return null;
    },
    [columns]
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

        if (!overColumn || activeColumn === overColumn) return prev;

        // Move the task from source to destination
        const sourceTasks = prev[activeColumn];
        const destTasks = prev[overColumn];
        const activeIndex = sourceTasks.findIndex((t) => t.id === activeId);
        if (activeIndex === -1) return prev;

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
    (event: DragEndEvent) => {
      const { active, over } = event;
      const finalState = dragState;

      // Clear drag UI state
      setActiveTask(null);
      setDragState(null);
      activeIdRef.current = null;

      if (!over || !finalState) return;

      const activeId = active.id as string;
      const overId = over.id as string;

      // Find where the task ended up in our local drag state
      const originalColumn = findColumn(activeId, tasksByStatus);
      const finalColumn = findColumn(activeId, finalState);

      if (!originalColumn || !finalColumn) return;

      if (originalColumn === finalColumn && !columnIds.includes(overId as TaskStatus)) {
        // Same column — check for reorder
        const columnTasks = finalState[finalColumn];
        const origColumnTasks = tasksByStatus[originalColumn];
        const oldIndex = origColumnTasks.findIndex((t: Task) => t.id === activeId);
        const newIndex = columnTasks.findIndex((t: Task) => t.id === activeId);

        if (oldIndex !== newIndex && oldIndex >= 0 && newIndex >= 0) {
          const reordered = arrayMove(origColumnTasks, oldIndex, newIndex);
          onReorder(reordered.map((t: Task) => t.id));
        }
      } else if (originalColumn !== finalColumn) {
        // Cross-column: commit the status change and new order
        onStatusChange(activeId, finalColumn);

        // Send the new order for the destination column
        const newOrder = finalState[finalColumn].map((t: Task) => t.id);
        onReorder(newOrder);
      }
    },
    [columnIds, dragState, findColumn, onReorder, onStatusChange, tasksByStatus]
  );

  return {
    activeTask,
    isDragActive: activeTask !== null,
    liveTasksByStatus,
    sensors,
    collisionDetection,
    handleDragStart,
    handleDragOver,
    handleDragEnd,
  };
}
