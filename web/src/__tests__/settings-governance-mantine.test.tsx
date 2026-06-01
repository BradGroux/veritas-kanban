import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { SharedResourcesTab } from '@/components/settings/tabs/SharedResourcesTab';
import { ToolPoliciesTab } from '@/components/settings/tabs/ToolPoliciesTab';
import { renderWithProviders } from './test-utils';

const mocks = vi.hoisted(() => ({
  apiFetch: vi.fn(),
  debouncedUpdate: vi.fn(),
  toast: vi.fn(),
  settings: {
    sharedResources: {
      enabled: true,
      maxResources: 250,
      allowedTypes: ['prompt', 'skill'],
    },
  },
}));

const policies = [
  {
    role: 'planner',
    allowed: ['*'],
    denied: [],
    description: 'Plan work safely',
  },
  {
    role: 'custom',
    allowed: ['Read', 'Search', 'List', 'Inspect', 'Summarize', 'Report'],
    denied: ['Write'],
    description: 'Custom limited role',
  },
];

vi.mock('@/lib/api/helpers', () => ({
  apiFetch: mocks.apiFetch,
}));

vi.mock('@/hooks/useToast', () => ({
  useToast: () => ({ toast: mocks.toast }),
}));

vi.mock('@/hooks/useFeatureSettings', () => ({
  useFeatureSettings: () => ({
    settings: mocks.settings,
  }),
  useDebouncedFeatureUpdate: () => ({
    debouncedUpdate: mocks.debouncedUpdate,
    isPending: false,
  }),
}));

describe('Settings governance Mantine controls', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.apiFetch.mockImplementation(async (url: string) => {
      if (url === '/api/tool-policies') {
        return policies;
      }
      return policies[0];
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('renders Shared Resources checkbox and number controls through direct Mantine primitives', () => {
    const { container } = renderWithProviders(<SharedResourcesTab />);

    expect(screen.getByRole('textbox', { name: 'Max Resources' })).toBeDefined();
    expect(screen.getByRole('checkbox', { name: 'Prompt' })).toBeDefined();
    expect(screen.getByRole('checkbox', { name: 'Skill' })).toBeDefined();
    expect(container.querySelector('.mantine-NumberInput-root')).toBeDefined();
    expect(container.querySelectorAll('.mantine-Checkbox-root').length).toBeGreaterThanOrEqual(5);
    expect(container.querySelector('[data-slot="checkbox"]')).toBeNull();

    fireEvent.click(screen.getByRole('checkbox', { name: 'Template' }));

    expect(mocks.debouncedUpdate).toHaveBeenCalledWith({
      sharedResources: expect.objectContaining({
        allowedTypes: ['prompt', 'skill', 'template'],
      }),
    });
  });

  it('renders Tool Policies list and editor through direct Mantine primitives', async () => {
    const { baseElement } = renderWithProviders(<ToolPoliciesTab />);

    expect(await screen.findByText('planner')).toBeDefined();
    expect(screen.getByText('all tools')).toBeDefined();
    expect(screen.getByText('+1 more')).toBeDefined();
    expect(screen.getByRole('button', { name: 'New Policy' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Edit planner' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Delete custom' })).toBeDefined();
    expect(baseElement.querySelector('.mantine-Alert-root')).toBeDefined();
    expect(baseElement.querySelectorAll('.mantine-Badge-root').length).toBeGreaterThanOrEqual(4);
    expect(baseElement.querySelectorAll('.mantine-ActionIcon-root').length).toBeGreaterThanOrEqual(
      3
    );
    expect(baseElement.querySelector('[data-slot="button"]')).toBeNull();
    expect(baseElement.querySelector('[data-slot="input"]')).toBeNull();
    expect(baseElement.querySelector('[data-slot="textarea"]')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'New Policy' }));

    expect(screen.getByRole('textbox', { name: 'Role Name' })).toBeDefined();
    expect(screen.getByRole('textbox', { name: 'Allowed Tools' })).toBeDefined();
    expect(screen.getByRole('textbox', { name: 'Denied Tools' })).toBeDefined();
    expect(screen.getByRole('textbox', { name: 'Description' })).toBeDefined();
    expect(baseElement.querySelector('.mantine-Modal-root')).toBeDefined();
    expect(baseElement.querySelectorAll('.mantine-TextInput-root').length).toBeGreaterThanOrEqual(
      3
    );
    expect(baseElement.querySelector('.mantine-Textarea-root')).toBeDefined();

    fireEvent.change(screen.getByRole('textbox', { name: 'Role Name' }), {
      target: { value: 'analyst' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: 'Allowed Tools' }), {
      target: { value: 'Read, Search' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: 'Denied Tools' }), {
      target: { value: 'Write' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: 'Description' }), {
      target: { value: 'Read-only analyst role' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => {
      expect(mocks.apiFetch).toHaveBeenCalledWith(
        '/api/tool-policies',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            role: 'analyst',
            allowed: ['Read', 'Search'],
            denied: ['Write'],
            description: 'Read-only analyst role',
          }),
        })
      );
    });
  });
});
