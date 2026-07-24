import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ViewProvider, useView } from '@/contexts/ViewContext';
import { renderWithProviders } from './test-utils';

function NavigationHarness() {
  const { view, setView, navigateToTask, pendingTaskId, goBack, returnFromTask } = useView();

  return (
    <>
      <output data-testid="current-view">{view}</output>
      <output data-testid="pending-task">{pendingTaskId ?? 'none'}</output>
      <button type="button" onClick={() => setView('activity')}>
        Open Activity
      </button>
      <button type="button" onClick={() => setView('workflows')}>
        Open Workflows
      </button>
      <button type="button" onClick={() => navigateToTask('task-route-context')}>
        Open Task
      </button>
      <button type="button" onClick={returnFromTask}>
        Close Task
      </button>
      <button type="button" onClick={goBack}>
        Back
      </button>
    </>
  );
}

function renderNavigationHarness() {
  return renderWithProviders(
    <div id="main-content">
      <ViewProvider>
        <NavigationHarness />
      </ViewProvider>
    </div>
  );
}

describe('ViewContext route history', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', '/');
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('returns Activity task navigation to its route and scroll position', async () => {
    const user = userEvent.setup();
    renderNavigationHarness();

    await user.click(screen.getByRole('button', { name: 'Open Activity' }));
    expect(screen.getByTestId('current-view').textContent).toBe('activity');
    expect(window.location.pathname).toBe('/activity');

    const main = document.getElementById('main-content') as HTMLDivElement;
    main.scrollTop = 420;
    fireEvent.scroll(main);
    await waitFor(() => {
      expect(window.history.state.veritasKanbanNavigation.scrollTop).toBe(420);
    });
    const activityState = window.history.state;

    await user.click(screen.getByRole('button', { name: 'Open Task' }));
    expect(screen.getByTestId('current-view').textContent).toBe('board');
    expect(screen.getByTestId('pending-task').textContent).toBe('task-route-context');
    expect(window.location.pathname).toBe('/');

    vi.spyOn(window.history, 'back').mockImplementation(() => {
      window.history.replaceState(activityState, '', '/activity');
      window.dispatchEvent(new PopStateEvent('popstate', { state: activityState }));
    });
    await user.click(screen.getByRole('button', { name: 'Close Task' }));

    await waitFor(() => {
      expect(screen.getByTestId('current-view').textContent).toBe('activity');
      expect(main.scrollTop).toBe(420);
    });
  });

  it('falls back from a direct feature link to Board without a history origin', async () => {
    window.history.replaceState({}, '', '/workflows');
    const user = userEvent.setup();
    renderNavigationHarness();

    expect(screen.getByTestId('current-view').textContent).toBe('workflows');
    await user.click(screen.getByRole('button', { name: 'Back' }));

    expect(screen.getByTestId('current-view').textContent).toBe('board');
    expect(window.location.pathname).toBe('/');
  });

  it('maps Cmd+[ to in-app browser Back semantics', async () => {
    const user = userEvent.setup();
    renderNavigationHarness();
    await user.click(screen.getByRole('button', { name: 'Open Workflows' }));

    const back = vi.spyOn(window.history, 'back').mockImplementation(() => {});
    fireEvent.keyDown(window, { key: '[', metaKey: true });

    expect(back).toHaveBeenCalledOnce();
  });
});
