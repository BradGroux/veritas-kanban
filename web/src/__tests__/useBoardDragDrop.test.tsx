import { act, renderHook, waitFor } from '@testing-library/react';
import { KeyboardSensor, PointerSensor } from '@dnd-kit/core';
import type { DragCancelEvent, DragEndEvent, DragOverEvent, DragStartEvent } from '@dnd-kit/core';
import { describe, expect, it, vi, type Mock } from 'vitest';
import { DEFAULT_FEATURE_SETTINGS, type Task, type TaskStatus } from '@veritas-kanban/shared';
import { createBoardKeyboardCoordinates, useBoardDragDrop } from '@/hooks/useBoardDragDrop';
import { createMockTask } from './test-utils';

const columns = DEFAULT_FEATURE_SETTINGS.board.columns;
type StatusChange = (taskId: string, status: TaskStatus) => Promise<void>;
type Reorder = (taskIds: string[]) => Promise<void>;
type Announce = (message: string) => void;

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
  onStatusChange = vi.fn<StatusChange>().mockResolvedValue(undefined),
  onReorder = vi.fn<Reorder>().mockResolvedValue(undefined),
  announce = vi.fn<Announce>(),
}: {
  tasks?: Task[];
  onStatusChange?: Mock<StatusChange>;
  onReorder?: Mock<Reorder>;
  announce?: Mock<Announce>;
} = {}) {
  const tasksByStatus = Object.fromEntries(
    columns.map((column) => [column.id, tasks.filter((task) => task.status === column.id)])
  );

  const hook = renderHook(() =>
    useBoardDragDrop({
      tasks,
      tasksByStatus,
      columns,
      onStatusChange,
      onReorder,
      announce,
    })
  );

  return { ...hook, announce, onReorder, onStatusChange };
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
    const { result, onReorder, announce } = renderDragHook();

    act(() => result.current.handleDragStart(dragEvent('todo-2') as unknown as DragStartEvent));
    act(() => result.current.handleDragOver(dragEvent('todo-2', 'todo-1') as DragOverEvent));
    await act(async () =>
      result.current.handleDragEnd(dragEvent('todo-2', 'todo-1') as DragEndEvent)
    );

    expect(onReorder).toHaveBeenCalledWith(['todo-2', 'todo-1']);
    expect(announce).toHaveBeenCalledWith('Second task moved to To Do, position 1 of 2');
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
    const onStatusChange = vi.fn<StatusChange>().mockImplementation(async () => {
      originalCard.remove();
      document.body.append(movedCard);
    });
    const { result, onReorder, announce } = renderDragHook({ tasks, onStatusChange });

    act(() => result.current.handleDragStart(dragEvent('todo-1') as unknown as DragStartEvent));
    act(() => result.current.handleDragOver(dragEvent('todo-1', 'done') as DragOverEvent));
    await act(async () =>
      result.current.handleDragEnd(dragEvent('todo-1', 'done') as DragEndEvent)
    );

    expect(onStatusChange).toHaveBeenCalledWith('todo-1', 'done');
    expect(onReorder).toHaveBeenCalledWith(['todo-1']);
    expect(announce).toHaveBeenCalledWith('First task moved to Done, position 1 of 1');
    await waitFor(() => expect(document.activeElement).toBe(movedCard));
    movedCard.remove();
  });

  it('cancels without persisting and restores focus to the active task', async () => {
    const card = document.createElement('button');
    card.dataset.taskId = 'todo-1';
    document.body.append(card);
    const { result, onReorder, onStatusChange, announce } = renderDragHook();

    act(() => result.current.handleDragStart(dragEvent('todo-1') as unknown as DragStartEvent));
    act(() => result.current.handleDragCancel(dragEvent('todo-1') as DragCancelEvent));

    await waitFor(() => expect(document.activeElement).toBe(card));
    expect(onStatusChange).not.toHaveBeenCalled();
    expect(onReorder).not.toHaveBeenCalled();
    expect(announce).toHaveBeenCalledWith(
      'Move canceled. First task returned to To Do, position 1 of 2'
    );
    card.remove();
  });

  it('announces a same-column rollback when reordering fails', async () => {
    const onReorder = vi.fn<Reorder>().mockRejectedValue(new Error('network failed'));
    const { result, announce } = renderDragHook({ onReorder });

    act(() => result.current.handleDragStart(dragEvent('todo-2') as unknown as DragStartEvent));
    act(() => result.current.handleDragOver(dragEvent('todo-2', 'todo-1') as DragOverEvent));
    await act(async () =>
      result.current.handleDragEnd(dragEvent('todo-2', 'todo-1') as DragEndEvent)
    );

    expect(announce).toHaveBeenCalledWith(
      'Move failed. Second task returned to To Do, position 2 of 2'
    );
  });

  it('rolls status back when destination ordering fails', async () => {
    const onStatusChange = vi.fn<StatusChange>().mockResolvedValue(undefined);
    const onReorder = vi.fn<Reorder>().mockRejectedValue(new Error('network failed'));
    const { result, announce } = renderDragHook({ onStatusChange, onReorder });

    act(() => result.current.handleDragStart(dragEvent('todo-1') as unknown as DragStartEvent));
    act(() => result.current.handleDragOver(dragEvent('todo-1', 'done') as DragOverEvent));
    await act(async () =>
      result.current.handleDragEnd(dragEvent('todo-1', 'done') as DragEndEvent)
    );

    expect(onStatusChange.mock.calls).toEqual([
      ['todo-1', 'done'],
      ['todo-1', 'todo'],
    ]);
    expect(announce).toHaveBeenCalledWith(
      'Move failed. First task returned to To Do, position 1 of 2'
    );
  });

  it('announces a partial failure when automatic status rollback also fails', async () => {
    const onStatusChange = vi
      .fn<StatusChange>()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('rollback failed'));
    const onReorder = vi.fn<Reorder>().mockRejectedValue(new Error('network failed'));
    const { result, announce } = renderDragHook({ onStatusChange, onReorder });

    act(() => result.current.handleDragStart(dragEvent('todo-1') as unknown as DragStartEvent));
    act(() => result.current.handleDragOver(dragEvent('todo-1', 'done') as DragOverEvent));
    await act(async () =>
      result.current.handleDragEnd(dragEvent('todo-1', 'done') as DragEndEvent)
    );

    expect(announce).toHaveBeenCalledWith(
      'Move partially failed. First task may still be in Done because automatic rollback failed; refresh the board before trying again'
    );
  });
});
