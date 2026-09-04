import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Badge, Button } from '@mantine/core';

import { PrimaryPageShell } from '@/components/layout/PrimaryPageShell';
import { renderWithProviders } from './test-utils';

describe('PrimaryPageShell', () => {
  afterEach(cleanup);

  it('renders one route heading and the shared icon-only back action', async () => {
    const onBack = vi.fn();
    const user = userEvent.setup();

    renderWithProviders(
      <PrimaryPageShell
        title="Evidence Timeline"
        subtitle="Chronological source-backed evidence."
        status={<Badge>5 citations</Badge>}
        actions={<Button>Generate recap</Button>}
        onBack={onBack}
      >
        <div>Timeline content</div>
      </PrimaryPageShell>
    );

    const heading = screen.getByRole('heading', { level: 1, name: 'Evidence Timeline' });
    expect(heading.style.fontSize).toBe('1.5rem');
    expect(heading.style.lineHeight).toBe('2rem');
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    await waitFor(() => expect(document.activeElement).toBe(heading));
    expect(screen.getByText('Chronological source-backed evidence.')).toBeTruthy();
    expect(screen.getByText('5 citations')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Generate recap' })).toBeTruthy();

    const back = screen.getByRole('button', { name: 'Back' });
    expect(back.textContent).not.toContain('Back');
    await user.click(back);
    expect(onBack).toHaveBeenCalledOnce();
  });

  it('does not steal focus again when in-page content rerenders', async () => {
    const { rerender } = renderWithProviders(
      <PrimaryPageShell title="Backlog" onBack={vi.fn()} width="wide">
        <button type="button">Filter tasks</button>
      </PrimaryPageShell>
    );

    const heading = screen.getByRole('heading', { level: 1, name: 'Backlog' });
    await waitFor(() => expect(document.activeElement).toBe(heading));
    screen.getByRole('button', { name: 'Filter tasks' }).focus();

    rerender(
      <PrimaryPageShell title="Backlog" onBack={vi.fn()} width="wide">
        <button type="button">Filter tasks</button>
        <div>Updated task count</div>
      </PrimaryPageShell>
    );

    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Filter tasks' }));
    expect(screen.getByLabelText('Backlog').getAttribute('data-page-width')).toBe('wide');
  });
});
