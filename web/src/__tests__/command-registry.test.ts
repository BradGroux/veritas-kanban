import { describe, expect, it } from 'vitest';

import { createCommandRegistry } from '@/lib/command-registry';
import { VIEW_DEFINITIONS } from '@/lib/views';

describe('command registry', () => {
  it('exposes shared command descriptors without duplicate ids', () => {
    const commands = createCommandRegistry({ theme: 'dark' });
    const ids = commands.map((command) => command.id);

    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain('new-task');
    expect(ids).toContain('open-search');
    expect(ids).toContain('move-todo');
  });

  it('registers navigation commands from the shared view definitions', () => {
    const commands = createCommandRegistry({ theme: 'dark' });

    for (const view of VIEW_DEFINITIONS) {
      const command = commands.find((item) => item.id === `go-${view.view}`);

      expect(command?.label).toBe(view.commandLabel);
      expect(command?.action).toEqual({ type: 'navigate-view', view: view.view });
      expect(command?.keywords).toBe(view.keywords);
    }
  });

  it('tracks theme-sensitive command labels and the expanded search surface', () => {
    const darkCommands = createCommandRegistry({ theme: 'dark' });
    const lightCommands = createCommandRegistry({ theme: 'light' });

    expect(darkCommands.find((command) => command.id === 'toggle-theme')?.label).toBe(
      'Switch to Light Mode'
    );
    expect(lightCommands.find((command) => command.id === 'toggle-theme')?.label).toBe(
      'Switch to Dark Mode'
    );
    expect(darkCommands.find((command) => command.id === 'open-search')?.label).toBe(
      'Search Tasks, Docs, and Work Products'
    );
  });

  it('marks board-context commands unavailable until a task is selected', () => {
    const commands = createCommandRegistry({ theme: 'dark' });
    const boardCommand = commands.find((command) => command.id === 'move-done');

    expect(boardCommand?.disabledReason).toBe('Select a task on the board to use this shortcut.');
  });

  it('makes the selected-task Work View path discoverable from command search', () => {
    const commands = createCommandRegistry({ theme: 'dark' });
    const openTask = commands.find((command) => command.id === 'open-task');

    expect(openTask?.keywords).toEqual(expect.arrayContaining(['work', 'work view']));
    expect(openTask?.aliases).toEqual(expect.arrayContaining(['open work view', 'task work']));
  });
});
