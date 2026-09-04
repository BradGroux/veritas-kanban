import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, screen } from '@testing-library/react';
import { MobileShell } from '@/components/layout/MobileShell';
import { renderWithProviders } from './test-utils';

const setView = vi.hoisted(() => vi.fn());
vi.mock('@/contexts/ViewContext', () => ({ useView: () => ({ view: 'board', setView }) }));
vi.mock('@/hooks/useIdentity', () => ({ useIdentity: () => ({ hasPermission: () => true }) }));
vi.mock('@/components/dashboard/NeedsAttentionQueue', () => ({ NeedsAttentionQueue: () => null }));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  setView.mockClear();
});

it.each([59, 74])(
  'uses the actual %ipx toolbar height without changing Home navigation',
  (height) => {
    vi.useFakeTimers();
    const scrollTo = vi.fn();
    vi.stubGlobal('scrollTo', scrollTo);
    vi.stubGlobal('scrollY', 100);
    renderWithProviders(
      <>
        <header className="desktop-app-header" />
        <section id="mobile-board-columns" />
        <MobileShell />
      </>
    );
    const header = document.querySelector('.desktop-app-header');
    const columns = document.getElementById('mobile-board-columns');
    if (!header || !columns) throw new Error('Missing scroll fixture');
    vi.spyOn(header, 'getBoundingClientRect').mockReturnValue({ height } as DOMRect);
    vi.spyOn(columns, 'getBoundingClientRect').mockReturnValue({ top: 400 } as DOMRect);
    fireEvent.click(screen.getByRole('button', { name: 'Mobile board' }));
    act(() => vi.runOnlyPendingTimers());
    expect(setView).toHaveBeenCalledWith('board');
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 500 - height, behavior: 'instant' });
    fireEvent.click(screen.getByRole('button', { name: 'Mobile home' }));
    act(() => vi.runOnlyPendingTimers());
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 0, behavior: 'smooth' });
  }
);

it('does not scroll an unrelated surface when columns are absent', () => {
  vi.useFakeTimers();
  const scrollTo = vi.fn();
  vi.stubGlobal('scrollTo', scrollTo);
  renderWithProviders(<MobileShell />);
  fireEvent.click(screen.getByRole('button', { name: 'Mobile board' }));
  act(() => vi.runOnlyPendingTimers());
  expect(scrollTo).not.toHaveBeenCalled();
});

it.each([false, true])('handles delayed columns with Home cancellation=%s', async (cancel) => {
  vi.useFakeTimers();
  const scrollTo = vi.fn();
  vi.stubGlobal('scrollTo', scrollTo);
  const shell = (loaded: boolean) => (
    <>
      <main id="main-content">{loaded && <section id="mobile-board-columns" />}</main>
      <MobileShell />
    </>
  );
  const { rerender } = renderWithProviders(shell(false));
  fireEvent.click(screen.getByRole('button', { name: 'Mobile board' }));
  act(() => vi.runOnlyPendingTimers());
  expect(scrollTo).not.toHaveBeenCalled();
  if (cancel) {
    fireEvent.click(screen.getByRole('button', { name: 'Mobile home' }));
    act(() => vi.runOnlyPendingTimers());
    scrollTo.mockClear();
  }
  await act(async () => {
    rerender(shell(true));
  });
  act(() => vi.runOnlyPendingTimers());
  if (cancel) expect(scrollTo).not.toHaveBeenCalled();
  else expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'instant' });
});

it('disconnects a pending jump when the mobile shell unmounts', async () => {
  vi.useFakeTimers();
  const scrollTo = vi.fn();
  vi.stubGlobal('scrollTo', scrollTo);
  const { rerender } = renderWithProviders(
    <>
      <main id="main-content" />
      <MobileShell />
    </>
  );
  fireEvent.click(screen.getByRole('button', { name: 'Mobile board' }));
  act(() => vi.runOnlyPendingTimers());
  await act(async () => {
    rerender(
      <main id="main-content">
        <section id="mobile-board-columns" />
      </main>
    );
  });
  act(() => vi.runOnlyPendingTimers());
  expect(scrollTo).not.toHaveBeenCalled();
});
