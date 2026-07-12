import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { GeneralTab } from '@/components/settings/tabs/GeneralTab';
import { renderWithProviders } from './test-utils';

const mocks = vi.hoisted(() => ({
  addRepo: vi.fn(),
  debouncedUpdate: vi.fn(),
  removeRepo: vi.fn(),
  setDefaultAgent: vi.fn(),
  setTheme: vi.fn(),
  validatePath: vi.fn(),
}));

vi.mock('@/hooks/useConfig', () => ({
  useConfig: () => ({
    data: {
      repos: [
        {
          name: 'veritas',
          path: '/Users/bradgroux/Projects/veritas-kanban',
          defaultBranch: 'main',
        },
      ],
      agents: [
        { type: 'codex', name: 'Codex', enabled: true },
        { type: 'claude', name: 'Claude', enabled: true },
      ],
      defaultAgent: 'codex',
    },
    isLoading: false,
  }),
  useAddRepo: () => ({
    mutateAsync: mocks.addRepo,
    isPending: false,
  }),
  useRemoveRepo: () => ({
    mutate: mocks.removeRepo,
  }),
  useValidateRepoPath: () => ({
    mutateAsync: mocks.validatePath,
    isPending: false,
    error: null,
  }),
  useSetDefaultAgent: () => ({
    mutate: mocks.setDefaultAgent,
  }),
}));

vi.mock('@/hooks/useFeatureSettings', () => ({
  useFeatureSettings: () => ({
    settings: {
      general: { humanDisplayName: 'Human' },
      productMode: { selectedMode: 'advanced', dismissedHints: [] },
    },
  }),
  useDebouncedFeatureUpdate: () => ({
    debouncedUpdate: mocks.debouncedUpdate,
  }),
}));

vi.mock('@/hooks/useTheme', () => ({
  useTheme: () => ({
    theme: 'dark',
    setTheme: mocks.setTheme,
  }),
}));

describe('General settings Mantine migration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
    mocks.validatePath.mockResolvedValue({ valid: true, branches: ['main', 'develop'] });
  });

  afterEach(() => {
    cleanup();
  });

  it('renders the base general settings controls through direct Mantine primitives', async () => {
    const { container } = renderWithProviders(<GeneralTab />);

    expect(screen.getByRole('switch', { name: 'Toggle dark mode' })).toBeDefined();
    expect(screen.getByRole('combobox', { name: 'Product Mode' })).toBeDefined();
    expect(screen.getAllByText('Advanced / Operator').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole('textbox', { name: 'Display Name (Squad Chat)' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Add Repo' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Default' })).toBeDefined();
    expect(container.querySelector('.mantine-Switch-root')).toBeDefined();
    expect(container.querySelector('.mantine-TextInput-root')).toBeDefined();
    expect(container.querySelector('.mantine-Button-root')).toBeDefined();
    expect(container.querySelector('.mantine-Badge-root')).toBeDefined();

    const productModeLayout = screen.getByTestId('product-mode-layout');
    expect(productModeLayout.className).toContain('flex-col');
    expect(productModeLayout.className).toContain('sm:flex-row');
    expect(
      screen.getByRole('combobox', { name: 'Product Mode' }).closest('.mantine-Select-root')
        ?.className
    ).toContain('w-full');

    fireEvent.click(screen.getByRole('switch', { name: 'Toggle dark mode' }));

    expect(mocks.setTheme).toHaveBeenCalledWith('light');

    fireEvent.click(screen.getByRole('combobox', { name: 'Product Mode' }));
    fireEvent.click(await screen.findByRole('option', { name: 'QA Review' }));

    expect(mocks.debouncedUpdate).toHaveBeenCalledWith({
      productMode: expect.objectContaining({ selectedMode: 'qa-review' }),
    });
  });

  it('renders add repository controls and branch selection through Mantine inputs', async () => {
    const { container } = renderWithProviders(<GeneralTab />);

    fireEvent.click(screen.getByRole('button', { name: 'Add Repo' }));

    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), {
      target: { value: 'demo' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: 'Path' }), {
      target: { value: '/tmp/demo' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Validate repository path' }));

    expect(mocks.validatePath).toHaveBeenCalledWith('/tmp/demo');
    expect(await screen.findByRole('combobox', { name: 'Default Branch' })).toBeDefined();
    expect(container.querySelectorAll('.mantine-TextInput-root').length).toBeGreaterThanOrEqual(3);
    expect(container.querySelector('.mantine-Select-root')).toBeDefined();
  });
});
