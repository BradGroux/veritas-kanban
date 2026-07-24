import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { TemplateEditorDialog } from '@/components/templates/TemplateEditorDialog';
import { renderWithProviders } from './test-utils';
import type { TaskTemplate } from '@/hooks/useTemplates';

const mocks = vi.hoisted(() => ({
  createTemplate: vi.fn(),
  updateTemplate: vi.fn(),
  toast: vi.fn(),
}));

vi.mock('@/hooks/useTemplates', () => ({
  useCreateTemplate: () => ({
    mutateAsync: mocks.createTemplate,
    isPending: false,
  }),
  useUpdateTemplate: () => ({
    mutateAsync: mocks.updateTemplate,
    isPending: false,
  }),
}));

vi.mock('@/hooks/useTaskTypes', () => ({
  useTaskTypesManager: () => ({
    items: [{ id: 'feature', label: 'Feature', icon: 'sparkles' }],
  }),
  getTypeIcon: () => () => null,
}));

vi.mock('@/hooks/useToast', () => ({
  useToast: () => ({ toast: mocks.toast }),
}));

const longMarkdown = Array.from(
  { length: 30 },
  (_, index) => `## Step ${index + 1}\n\n- Verify outcome ${index + 1}`
).join('\n\n');

const template: TaskTemplate = {
  id: 'template-long',
  name: 'Long authoring template',
  description: 'Exercises a long Markdown task description.',
  category: 'feature',
  version: 1,
  taskDefaults: {
    type: 'feature',
    priority: 'high',
    project: 'veritas-kanban',
    agent: 'gpt-4',
    descriptionTemplate: longMarkdown,
  },
  created: '2026-07-24T00:00:00.000Z',
  updated: '2026-07-24T00:00:00.000Z',
};

describe('TemplateEditorDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createTemplate.mockResolvedValue({});
    mocks.updateTemplate.mockResolvedValue({});
  });

  afterEach(() => {
    cleanup();
  });

  it('uses one bounded scroll region with fixed actions and a useful Markdown editor', async () => {
    const user = userEvent.setup();
    const { baseElement } = renderWithProviders(
      <TemplateEditorDialog template={template} open onOpenChange={vi.fn()} />
    );

    const modal = baseElement.querySelector('.mantine-Modal-content') as HTMLElement;
    const scrollRegion = screen.getByTestId('template-editor-scroll-region');
    const actions = screen.getByTestId('template-editor-actions');

    expect(modal.className).toContain('h-[min(780px,calc(100dvh-2rem))]');
    expect(modal.className).toContain('max-h-[calc(100dvh-2rem)]');
    expect(scrollRegion.className).toContain('overflow-y-auto');
    expect(scrollRegion.getAttribute('tabindex')).toBe('0');
    expect(scrollRegion.contains(actions)).toBe(false);

    await user.click(screen.getByRole('tab', { name: 'Task Defaults' }));

    const markdownEditor = screen.getByRole('textbox', { name: 'Description Template' });
    expect((markdownEditor as HTMLTextAreaElement).value).toBe(longMarkdown);
    expect((markdownEditor as HTMLTextAreaElement).style.minHeight).toBe('240px');
    expect((markdownEditor as HTMLTextAreaElement).style.resize).toBe('vertical');
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Update Template' })).toBeDefined();
  });

  it('warns before closing a dirty editor and keeps the modal open when declined', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    const confirmDiscard = vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderWithProviders(
      <TemplateEditorDialog template={template} open onOpenChange={onOpenChange} />
    );

    await user.clear(screen.getByRole('textbox', { name: /Template Name/i }));
    await user.type(screen.getByRole('textbox', { name: /Template Name/i }), 'Changed template');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(confirmDiscard).toHaveBeenCalledWith('Discard unsaved template changes?');
    expect(onOpenChange).not.toHaveBeenCalled();

    confirmDiscard.mockReturnValue(true);
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    confirmDiscard.mockRestore();
  });

  it('shows inline validation and does not create a nameless template', () => {
    renderWithProviders(<TemplateEditorDialog template={null} open onOpenChange={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Create Template' }));

    expect(screen.getByText('Template name is required')).toBeDefined();
    expect(mocks.createTemplate).not.toHaveBeenCalled();
    expect(mocks.toast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Validation Error',
        variant: 'destructive',
      })
    );
  });
});
