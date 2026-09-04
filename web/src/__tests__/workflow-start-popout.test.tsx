import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { WorkflowStartDialog } from '@/components/workflows/WorkflowStartDialog';
import { workflowsApi } from '@/lib/api/workflows';
import { renderWithProviders } from './test-utils';

const workflow = {
  id: 'fixture',
  name: 'Fixture',
  version: 1,
  description: 'Test only',
  agents: [],
  steps: [],
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('workflow start popout', () => {
  it('retains context after failure and accepts one successful retry', async () => {
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
    let rejectStart!: (error: Error) => void;
    const run = {
      id: 'run-fixture',
      workflowId: workflow.id,
      workflowVersion: 1,
      status: 'running' as const,
      startedAt: '2026-09-01T10:00:00Z',
      context: {},
      steps: [],
    };
    const start = vi
      .spyOn(workflowsApi, 'startRun')
      .mockImplementationOnce(
        () =>
          new Promise((_resolve, reject) => {
            rejectStart = reject;
          })
      )
      .mockResolvedValueOnce(run);
    const onClose = vi.fn();
    const onStarted = vi.fn();
    renderWithProviders(
      <WorkflowStartDialog workflow={workflow} onClose={onClose} onStarted={onStarted} />
    );
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close dialog' }))
    );
    fireEvent.change(screen.getByLabelText('Task ID'), { target: { value: ' task_fixture ' } });
    fireEvent.change(screen.getByLabelText('Run context'), {
      target: { value: '{"note":"retain"}' },
    });
    const submit = screen.getByRole('button', { name: 'Start Run' });
    fireEvent.click(submit);
    fireEvent.click(submit);
    fireEvent.keyDown(document.body, { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(start).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
    expect((screen.getByLabelText('Run context') as HTMLTextAreaElement).disabled).toBe(true);
    await act(async () => rejectStart(new Error('Fixture failed')));
    expect(screen.getByRole('alert').textContent).toContain('Fixture failed');
    expect(document.activeElement).toBe(screen.getByRole('alert'));
    expect((screen.getByLabelText('Run context') as HTMLTextAreaElement).value).toBe(
      '{"note":"retain"}'
    );
    await act(async () => fireEvent.click(submit));
    expect(start).toHaveBeenCalledTimes(2);
    expect(start).toHaveBeenLastCalledWith('fixture', {
      taskId: 'task_fixture',
      context: { note: 'retain' },
    });
    expect(onStarted).toHaveBeenCalledExactlyOnceWith(run);
  });

  it('keeps invalid JSON recoverable without launching', async () => {
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
    const start = vi.spyOn(workflowsApi, 'startRun');
    renderWithProviders(
      <WorkflowStartDialog workflow={workflow} onClose={vi.fn()} onStarted={vi.fn()} />
    );
    fireEvent.change(screen.getByLabelText('Run context'), { target: { value: '[]' } });
    fireEvent.click(screen.getByRole('button', { name: 'Start Run' }));
    expect(screen.getByRole('alert').textContent).toContain('Run context must be a JSON object');
    expect(start).not.toHaveBeenCalled();
    expect((screen.getByRole('button', { name: 'Start Run' }) as HTMLButtonElement).disabled).toBe(
      false
    );
  });
});
