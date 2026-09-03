import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
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
    const { baseElement } = renderWithProviders(
      <TemplateEditorDialog template={template} open onOpenChange={vi.fn()} />
    );

    const modal = baseElement.querySelector('.mantine-Modal-content') as HTMLElement;
    const scrollRegion = screen.getByTestId('template-editor-scroll-region');
    const actions = screen.getByTestId('template-editor-actions');

    expect(modal.className).toContain('h-[min(45rem,calc(100dvh-2rem))]');
    expect(modal.className).toContain('max-h-[calc(100dvh-2rem)]');
    expect(scrollRegion.className).toContain('vk-overlay-scroll');
    expect(scrollRegion.getAttribute('tabindex')).toBe('0');
    expect(scrollRegion.contains(actions)).toBe(false);

    expect(screen.getByRole('region', { name: 'Basic Information' })).toBeDefined();
    expect(screen.getByRole('region', { name: 'Task Defaults' })).toBeDefined();

    const markdownEditor = screen.getByRole('textbox', { name: 'Description Template' });
    expect((markdownEditor as HTMLTextAreaElement).value).toBe(longMarkdown);
    expect((markdownEditor as HTMLTextAreaElement).style.minHeight).toBe('10rem');
    expect((markdownEditor as HTMLTextAreaElement).style.resize).toBe('vertical');
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Update Template' })).toBeDefined();
  });

  it('warns before closing a dirty editor and keeps the modal open when declined', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    renderWithProviders(
      <TemplateEditorDialog template={template} open onOpenChange={onOpenChange} />
    );

    await user.clear(screen.getByRole('textbox', { name: /Template Name/i }));
    await user.type(screen.getByRole('textbox', { name: /Template Name/i }), 'Changed template');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.getByRole('dialog', { name: 'Discard template changes?' })).toBeDefined();
    expect(onOpenChange).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Keep editing' }));
    expect(
      (screen.getByRole('textbox', { name: /Template Name/i }) as HTMLInputElement).value
    ).toBe('Changed template');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await user.click(screen.getByRole('button', { name: 'Discard changes' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('shows inline validation and does not create a nameless template', () => {
    renderWithProviders(<TemplateEditorDialog template={null} open onOpenChange={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Create Template' }));

    expect(screen.getByText('Template name is required')).toBeDefined();
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: /Template Name/i }));
    expect(mocks.createTemplate).not.toHaveBeenCalled();
    expect(mocks.toast).not.toHaveBeenCalled();
  });

  it.each([null, template])(
    'saves create and edit using the same authoring form',
    async (editingTemplate) => {
      const user = userEvent.setup();
      const onOpenChange = vi.fn();
      renderWithProviders(
        <TemplateEditorDialog template={editingTemplate} open onOpenChange={onOpenChange} />
      );
      const name = screen.getByRole('textbox', { name: /Template Name/i });
      await user.clear(name);
      await user.type(name, 'Ready for use');
      await user.keyboard('{Enter}');
      const mutation = editingTemplate ? mocks.updateTemplate : mocks.createTemplate;
      expect(mutation).toHaveBeenCalledOnce();
      expect(mutation).toHaveBeenCalledWith(
        editingTemplate
          ? {
              id: template.id,
              input: expect.objectContaining({
                name: 'Ready for use',
                taskDefaults: expect.objectContaining({ descriptionTemplate: longMarkdown }),
              }),
            }
          : expect.objectContaining({ name: 'Ready for use' })
      );
      expect(onOpenChange).toHaveBeenCalledWith(false);
    }
  );

  it('preserves the draft and focuses an inline error after save failure', async () => {
    mocks.updateTemplate.mockRejectedValue(new Error('Connection unavailable'));
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    renderWithProviders(
      <TemplateEditorDialog template={template} open onOpenChange={onOpenChange} />
    );
    await user.click(screen.getByRole('button', { name: 'Update Template' }));
    const error = await screen.findByRole('alert');
    await waitFor(() => expect(document.activeElement).toBe(error));
    expect(error.textContent).toContain('Connection unavailable');
    expect(mocks.toast).not.toHaveBeenCalled();
    expect(
      (screen.getByRole('textbox', { name: 'Description Template' }) as HTMLTextAreaElement).value
    ).toBe(longMarkdown);
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it('blocks repeated submission and dismissal until a pending save settles', async () => {
    let finishSave!: (value: unknown) => void;
    mocks.createTemplate.mockReturnValue(
      new Promise((resolve) => {
        finishSave = resolve;
      })
    );
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    renderWithProviders(<TemplateEditorDialog template={null} open onOpenChange={onOpenChange} />);
    const name = screen.getByRole('textbox', { name: /Template Name/i }) as HTMLInputElement;
    await user.type(name, 'One template only');
    const form = name.closest('form');
    if (!form) throw new Error('Template name must belong to the authoring form');
    const close = screen.getByRole('button', { name: 'Close dialog' }) as HTMLButtonElement;
    act(() => {
      fireEvent.submit(form);
      fireEvent.submit(form);
      fireEvent.click(close);
    });
    expect(mocks.createTemplate).toHaveBeenCalledOnce();
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(name.disabled).toBe(true);
    expect(close.disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Cancel' }) as HTMLButtonElement).disabled).toBe(
      true
    );
    await act(async () => finishSave({}));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
