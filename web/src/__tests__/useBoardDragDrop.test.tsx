import { act, renderHook, waitFor } from '@testing-library/react';
import { KeyboardSensor, PointerSensor } from '@dnd-kit/core';
import type { DragCancelEvent, DragEndEvent, DragOverEvent, DragStartEvent } from '@dnd-kit/core';
import { describe, expect, it, vi, type Mock } from 'vitest';
import {
  DEFAULT_FEATURE_SETTINGS,
  type MoveTaskInput,
  type MoveTaskResult,
  type Task,
} from '@veritas-kanban/shared';
import { createBoardKeyboardCoordinates, useBoardDragDrop } from '@/hooks/useBoardDragDrop';
import { createMockTask } from './test-utils';

const columns = DEFAULT_FEATURE_SETTINGS.board.columns;
type Move = (
  taskId: string,
  input: Omit<MoveTaskInput, 'expectedRevision' | 'updatedBy'>
) => Promise<MoveTaskResult>;
type Announce = (message: string) => void;

function moveResult(task: Task, orderedTaskIds: string[] = [task.id]): MoveTaskResult {
  return {
    task,
    operationId: '00000000-0000-4000-8000-000000000099',
    orderedTaskIds,
    replayed: false,
  };
}

function dragEvent(activeId: string, overId?: string) {
  return {
    active: { id: activeId },
    over: overId ? { id: overId } : null,
  };
}

function renderDragHook({
  tasks = [
    createMockTask({ id: 'todo-1', title: 'First task', status: 'todo' }),
    createMockTask({ id: 'todo-2', title: 'Second task', status: 'todo' }),
    createMockTask({ id: 'done-1', title: 'Done task', status: 'done' }),
  ],
  allTasks = tasks,
  onMove = vi.fn<Move>().mockImplementation(async (taskId, input) => {
    const moved = tasks.find((task) => task.id === taskId) as Task;
    const orderedTaskIds = tasks
      .filter((task) => task.id !== taskId && task.status === input.destinationStatus)
      .map((task) => task.id);
    orderedTaskIds.splice(input.destinationIndex, 0, taskId);
    return moveResult(
      { ...moved, status: input.destinationStatus, position: input.destinationIndex },
      orderedTaskIds
    );
  }),
  announce = vi.fn<Announce>(),
}: {
  tasks?: Task[];
  allTasks?: Task[];
  onMove?: Mock<Move>;
  announce?: Mock<Announce>;
} = {}) {
  const tasksByStatus = Object.fromEntries(
    columns.map((column) => [column.id, tasks.filter((task) => task.status === column.id)])
  );
  const allTasksByStatus = Object.fromEntries(
    columns.map((column) => [column.id, allTasks.filter((task) => task.status === column.id)])
  );

  const hook = renderHook(() =>
    useBoardDragDrop({
      tasks,
      tasksByStatus,
      allTasksByStatus,
      columns,
      onMove,
      announce,
    })
  );

  return { ...hook, announce, onMove };
}

describe('useBoardDragDrop keyboard parity', () => {
  it('targets the next board column even when it has no sortable tasks', () => {
    const coordinateGetter = createBoardKeyboardCoordinates(['todo', 'done']);
    const preventDefault = vi.fn();
    const result = coordinateGetter(
      { code: 'ArrowRight', preventDefault } as unknown as KeyboardEvent,
      {
        active: 'todo-1',
        currentCoordinates: { x: 20, y: 100 },
        context: {
          collisionRect: {
            left: 20,
            right: 220,
            top: 100,
            bottom: 180,
            width: 200,
            height: 80,
          },
          droppableRects: new Map([
            ['todo', { left: 0, right: 240, top: 60, bottom: 700, width: 240, height: 640 }],
            ['done', { left: 260, right: 500, top: 60, bottom: 700, width: 240, height: 640 }],
          ]),
        },
      } as never
    );

    expect(preventDefault).toHaveBeenCalledOnce();
    expect(result).toEqual({ x: 280, y: 100 });
  });

  it('targets an empty column on another visual row', () => {
    const coordinateGetter = createBoardKeyboardCoordinates(['todo', 'done']);
    const preventDefault = vi.fn();
    const result = coordinateGetter(
      { code: 'ArrowUp', preventDefault } as unknown as KeyboardEvent,
      {
        active: 'done-1',
        currentCoordinates: { x: 20, y: 760 },
        context: {
          collisionRect: {
            left: 20,
            right: 220,
            top: 760,
            bottom: 840,
            width: 200,
            height: 80,
          },
          droppableRects: new Map([
            ['todo', { left: 0, right: 240, top: 60, bottom: 700, width: 240, height: 640 }],
            ['done', { left: 0, right: 240, top: 720, bottom: 1360, width: 240, height: 640 }],
          ]),
        },
      } as never
    );

    expect(preventDefault).toHaveBeenCalledOnce();
    expect(result).toEqual({ x: 20, y: 60 });
  });

  it('registers pointer and keyboard sensors and accurate keyboard instructions', () => {
    const { result } = renderDragHook();

    expect(result.current.sensors.map((descriptor) => descriptor.sensor)).toEqual([
      PointerSensor,
      KeyboardSensor,
    ]);
    expect(result.current.screenReaderInstructions.draggable).toContain('arrow keys');
    expect(result.current.screenReaderInstructions.draggable).toContain('Escape');
    expect(
      result.current.announcements.onDragOver({
        active: { id: 'todo-1' },
        over: { id: 'todo' },
      } as never)
    ).toBe('First task is over To Do, position 1 of 2.');
  });

  it('reorders within a column and announces the committed position', async () => {
    const { result, onMove, announce } = renderDragHook();

    act(() => result.current.handleDragStart(dragEvent('todo-2') as unknown as DragStartEvent));
    act(() => result.current.handleDragOver(dragEvent('todo-2', 'todo-1') as DragOverEvent));
    await act(async () =>
      result.current.handleDragEnd(dragEvent('todo-2', 'todo-1') as DragEndEvent)
    );

    expect(onMove).toHaveBeenCalledWith(
      'todo-2',
      expect.objectContaining({
        sourceStatus: 'todo',
        sourcePosition: null,
        destinationStatus: 'todo',
        destinationIndex: 0,
      })
    );
    expect(announce).toHaveBeenCalledWith('Second task moved to To Do, position 1 of 2');
  });

  it.each([
    { overId: 'todo-1', destinationStatus: 'todo' },
    { overId: 'blocked', destinationStatus: 'blocked' },
  ])(
    'commits the latest $destinationStatus projection before a render',
    async ({ overId, destinationStatus }) => {
      const { result, onMove } = renderDragHook();

      act(() => result.current.handleDragStart(dragEvent('todo-2') as unknown as DragStartEvent));
      await act(async () => {
        result.current.handleDragOver(dragEvent('todo-2', overId) as DragOverEvent);
        await result.current.handleDragEnd(dragEvent('todo-2', 'todo-2') as DragEndEvent);
      });

      expect(onMove).toHaveBeenCalledOnce();
      expect(onMove).toHaveBeenCalledWith(
        'todo-2',
        expect.objectContaining({ destinationStatus, destinationIndex: 0 })
      );
    }
  );

  it('announces the authoritative order when the committed result differs from projection', async () => {
    const tasks = [
      createMockTask({ id: 'todo-1', title: 'First task', status: 'todo' }),
      createMockTask({ id: 'todo-2', title: 'Second task', status: 'todo' }),
    ];
    const onMove = vi.fn<Move>().mockResolvedValue(moveResult(tasks[1], ['todo-1', 'todo-2']));
    const { result, announce } = renderDragHook({ tasks, onMove });

    act(() => result.current.handleDragStart(dragEvent('todo-2') as unknown as DragStartEvent));
    act(() => result.current.handleDragOver(dragEvent('todo-2', 'todo-1') as DragOverEvent));
    await act(async () =>
      result.current.handleDragEnd(dragEvent('todo-2', 'todo-1') as DragEndEvent)
    );

    expect(announce).toHaveBeenCalledWith('Second task moved to To Do, position 2 of 2');
  });

  it('translates a filtered drop relative to the full destination column', async () => {
    const moving = createMockTask({ id: 'todo-1', title: 'Moving task', status: 'todo' });
    const hidden = createMockTask({ id: 'done-hidden', status: 'done', position: 0 });
    const visible = createMockTask({ id: 'done-visible', status: 'done', position: 1 });
    const onMove = vi
      .fn<Move>()
      .mockResolvedValue(
        moveResult({ ...moving, status: 'done', position: 0.5 }, [hidden.id, moving.id, visible.id])
      );
    const { result } = renderDragHook({
      tasks: [moving, visible],
      allTasks: [moving, hidden, visible],
      onMove,
    });

    act(() => result.current.handleDragStart(dragEvent(moving.id) as unknown as DragStartEvent));
    act(() => result.current.handleDragOver(dragEvent(moving.id, visible.id) as DragOverEvent));
    await act(async () =>
      result.current.handleDragEnd(dragEvent(moving.id, visible.id) as DragEndEvent)
    );

    expect(onMove).toHaveBeenCalledWith(
      moving.id,
      expect.objectContaining({ destinationStatus: 'done', destinationIndex: 1 })
    );
  });

  it('moves a task into an empty column and persists its destination order', async () => {
    const tasks = [
      createMockTask({ id: 'todo-1', title: 'First task', status: 'todo' }),
      createMockTask({ id: 'todo-2', title: 'Second task', status: 'todo' }),
    ];
    const originalCard = document.createElement('button');
    originalCard.dataset.taskId = 'todo-1';
    document.body.append(originalCard);
    const movedCard = document.createElement('button');
    movedCard.dataset.taskId = 'todo-1';
    const onMove = vi.fn<Move>().mockImplementation(async () => {
      originalCard.remove();
      document.body.append(movedCard);
      return moveResult({ ...tasks[0], status: 'done', position: 0 });
    });
    const { result, announce } = renderDragHook({ tasks, onMove });

    act(() => result.current.handleDragStart(dragEvent('todo-1') as unknown as DragStartEvent));
    act(() => result.current.handleDragOver(dragEvent('todo-1', 'done') as DragOverEvent));
    await act(async () =>
      result.current.handleDragEnd(dragEvent('todo-1', 'done') as DragEndEvent)
    );

    expect(onMove).toHaveBeenCalledWith(
      'todo-1',
      expect.objectContaining({
        sourceStatus: 'todo',
        destinationStatus: 'done',
        destinationIndex: 0,
      })
    );
    expect(announce).toHaveBeenCalledWith('First task moved to Done, position 1 of 1');
    await waitFor(() => expect(document.activeElement).toBe(movedCard));
    movedCard.remove();
  });

  it('cancels without persisting and restores focus to the active task', async () => {
    const card = document.createElement('button');
    card.dataset.taskId = 'todo-1';
    document.body.append(card);
    const { result, onMove, announce } = renderDragHook();

    act(() => result.current.handleDragStart(dragEvent('todo-1') as unknown as DragStartEvent));
    await act(async () => {
      result.current.handleDragOver(dragEvent('todo-1', 'done') as DragOverEvent);
      result.current.handleDragCancel(dragEvent('todo-1') as DragCancelEvent);
      await result.current.handleDragEnd(dragEvent('todo-1', 'done') as DragEndEvent);
    });

    // A new drag must not inherit the canceled projection.
    await act(async () => {
      result.current.handleDragStart(dragEvent('todo-1') as unknown as DragStartEvent);
      await result.current.handleDragEnd(dragEvent('todo-1', 'todo-1') as DragEndEvent);
    });

    await waitFor(() => expect(document.activeElement).toBe(card));
    expect(onMove).not.toHaveBeenCalled();
    expect(announce).toHaveBeenCalledWith(
      'Move canceled. First task returned to To Do, position 1 of 2'
    );
    card.remove();
  });

  it('announces a same-column rollback when reordering fails', async () => {
    const onMove = vi.fn<Move>().mockRejectedValue(new Error('network failed'));
    const { result, announce } = renderDragHook({ onMove });

    act(() => result.current.handleDragStart(dragEvent('todo-2') as unknown as DragStartEvent));
    act(() => result.current.handleDragOver(dragEvent('todo-2', 'todo-1') as DragOverEvent));
    await act(async () =>
      result.current.handleDragEnd(dragEvent('todo-2', 'todo-1') as DragEndEvent)
    );

    expect(announce).toHaveBeenCalledWith(
      'Move failed. Second task returned to To Do, position 2 of 2'
    );
  });

  it('keeps the destination projection visible until the move command resolves', async () => {
    let resolveMove!: (result: MoveTaskResult) => void;
    const onMove = vi.fn<Move>().mockReturnValue(
      new Promise((resolve) => {
        resolveMove = resolve;
      })
    );
    const { result } = renderDragHook({ onMove });

    act(() => result.current.handleDragStart(dragEvent('todo-1') as unknown as DragStartEvent));
    act(() => result.current.handleDragOver(dragEvent('todo-1', 'done') as DragOverEvent));
    let completion!: Promise<void>;
    act(() => {
      completion = result.current.handleDragEnd(dragEvent('todo-1', 'done') as DragEndEvent);
    });

    expect(result.current.activeTask).toBeNull();
    expect(result.current.isMovePending).toBe(true);
    expect(result.current.liveTasksByStatus.done.map((task) => task.id)).toContain('todo-1');
    expect(result.current.liveTasksByStatus.todo.map((task) => task.id)).not.toContain('todo-1');

    act(() => resolveMove(moveResult({ ...result.current.liveTasksByStatus.done[0] })));
    await act(async () => completion);
    expect(result.current.isMovePending).toBe(false);
  });

  it('rejects another drag while the current task move is pending', async () => {
    let resolveMove!: (result: MoveTaskResult) => void;
    const onMove = vi.fn<Move>().mockReturnValue(
      new Promise((resolve) => {
        resolveMove = resolve;
      })
    );
    const { result, announce } = renderDragHook({ onMove });

    act(() => result.current.handleDragStart(dragEvent('todo-1') as unknown as DragStartEvent));
    act(() => result.current.handleDragOver(dragEvent('todo-1', 'done') as DragOverEvent));
    let completion!: Promise<void>;
    act(() => {
      completion = result.current.handleDragEnd(dragEvent('todo-1', 'done') as DragEndEvent);
    });
    act(() => result.current.handleDragStart(dragEvent('todo-2') as unknown as DragStartEvent));
    act(() => result.current.handleDragOver(dragEvent('todo-2', 'done-1') as DragOverEvent));
    await act(async () =>
      result.current.handleDragEnd(dragEvent('todo-2', 'done-1') as DragEndEvent)
    );

    expect(onMove).toHaveBeenCalledOnce();
    expect(announce).toHaveBeenCalledWith(
      'Wait for the current task move to finish before starting another move.'
    );

    act(() => resolveMove(moveResult(createMockTask({ id: 'todo-1', status: 'done' }))));
    await act(async () => completion);
  });
});
