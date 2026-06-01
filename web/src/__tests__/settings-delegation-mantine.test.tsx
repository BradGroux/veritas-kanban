import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { DelegationTab } from '@/components/settings/tabs/DelegationTab';
import { renderWithProviders } from './test-utils';
import type { DelegationSettings } from '@veritas-kanban/shared';

const mocks = vi.hoisted(() => ({
  toast: vi.fn(),
}));

vi.mock('@/hooks/useToast', () => ({
  useToast: () => ({
    toast: mocks.toast,
  }),
}));

let delegationResponse: DelegationSettings | null;

function mockDelegationFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      if (method === 'GET') {
        return new Response(JSON.stringify({ delegation: delegationResponse }), {
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ ok: true }), {
        headers: { 'Content-Type': 'application/json' },
      });
    })
  );
}

describe('Delegation settings Mantine migration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delegationResponse = null;
    mockDelegationFetch();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('renders setup controls through direct Mantine primitives and submits delegation', async () => {
    const { container } = renderWithProviders(<DelegationTab />);

    expect(await screen.findByText('Set Up Delegation')).toBeDefined();
    expect(screen.getByRole('combobox', { name: 'Delegate Agent' })).toBeDefined();
    expect(screen.getByRole('combobox', { name: 'Duration' })).toBeDefined();
    expect(screen.getByRole('combobox', { name: 'Scope' })).toBeDefined();
    expect(screen.getByRole('switch')).toBeDefined();
    expect(container.querySelectorAll('.mantine-Select-root')).toHaveLength(3);
    expect(container.querySelector('.mantine-Switch-root')).toBeDefined();
    expect(container.querySelector('.mantine-Button-root')).toBeDefined();

    fireEvent.click(screen.getByRole('switch'));
    fireEvent.click(screen.getByRole('button', { name: 'Enable Delegation' }));

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('/delegation'),
        expect.objectContaining({ method: 'POST' })
      );
    });

    const postCall = vi.mocked(fetch).mock.calls.find(([, init]) => init && init.method === 'POST');
    expect(JSON.parse(String(postCall?.[1]?.body))).toEqual(
      expect.objectContaining({
        delegateAgent: 'veritas',
        scope: { type: 'all' },
        createdBy: 'human',
      })
    );
    expect(JSON.parse(String(postCall?.[1]?.body))).not.toHaveProperty('excludePriorities');
  });

  it('renders active delegation state through Mantine badges and buttons', async () => {
    delegationResponse = {
      enabled: true,
      delegateAgent: 'veritas',
      expires: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      scope: { type: 'all' },
      excludePriorities: ['critical'],
      createdAt: new Date().toISOString(),
      createdBy: 'human',
    };

    const { container } = renderWithProviders(<DelegationTab />);

    expect((await screen.findAllByText('Delegation Active')).length).toBeGreaterThanOrEqual(2);
    expect(screen.getByRole('button', { name: 'Revoke Delegation' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Delegation Active' })).toBeDefined();
    expect(container.querySelectorAll('.mantine-Badge-root').length).toBeGreaterThanOrEqual(2);
    expect(container.querySelectorAll('.mantine-Button-root').length).toBeGreaterThanOrEqual(2);
  });
});
