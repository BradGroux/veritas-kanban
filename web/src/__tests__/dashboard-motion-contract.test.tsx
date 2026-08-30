import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DashboardSection } from '@/components/dashboard/DashboardSection';
import { renderWithProviders } from './test-utils';

vi.mock('@/components/dashboard/Dashboard', () => ({
  Dashboard: () => <div>Dashboard content loaded</div>,
}));

const motionSources = [
  'components/activity/ActivityFeed.tsx',
  'components/board/BoardSidebar.tsx',
  'components/board/KanbanColumn.tsx',
  'components/board/MultiAgentPanel.tsx',
  'components/chat/FloatingChat.tsx',
  'components/dashboard/Dashboard.tsx',
  'components/dashboard/DashboardPage.tsx',
  'components/dashboard/DashboardSection.tsx',
  'components/dashboard/HourlyActivityChart.tsx',
  'components/dashboard/StatusTimeline.tsx',
  'components/dashboard/WhereTimeWent.tsx',
  'components/layout/ActivitySidebar.tsx',
  'components/task/MultiAgentSelector.tsx',
  'components/task/TaskCard.tsx',
  'components/templates/TemplatesPage.tsx',
  'components/ui/badge.tsx',
  'components/ui/button.tsx',
  'components/ui/switch.tsx',
  'components/ui/tabs.tsx',
];

const stableStatusSources = [
  'components/board/BoardSidebar.tsx',
  'components/board/MultiAgentPanel.tsx',
  'components/chat/FloatingChat.tsx',
  'components/task/AgentPanel.tsx',
  'components/task/TaskCard.tsx',
  'components/task/TimeTrackingSection.tsx',
];

const storage = new Map<string, string>();
const localStorageStub = {
  clear: () => storage.clear(),
  getItem: (key: string) => storage.get(key) ?? null,
  key: (index: number) => [...storage.keys()][index] ?? null,
  get length() {
    return storage.size;
  },
  removeItem: (key: string) => storage.delete(key),
  setItem: (key: string, value: string) => storage.set(key, value),
};

describe('dashboard motion contract', () => {
  beforeEach(() => {
    storage.clear();
    vi.stubGlobal('localStorage', localStorageStub);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('avoids broad and layout-property transitions in active dashboard surfaces', () => {
    for (const file of motionSources) {
      const source = readFileSync(resolve(process.cwd(), 'src', file), 'utf8');

      expect(source, file).not.toContain('transition-all');
      expect(source, file).not.toMatch(/transition-\[(?:height|max-height|width)/);
      expect(source, file).not.toContain('max-h-[5000px]');
    }
  });

  it('keeps persistent live and unread status treatments stable', () => {
    for (const file of stableStatusSources) {
      const source = readFileSync(resolve(process.cwd(), 'src', file), 'utf8');

      expect(source, file).not.toContain('animate-ping');
      expect(source, file).not.toContain('animate-pulse');
      expect(source, file).not.toMatch(/hover:(?:scale|translate)/);
    }

    const taskCard = readFileSync(
      resolve(process.cwd(), 'src/components/task/TaskCard.tsx'),
      'utf8'
    );
    expect(taskCard).toContain('motion-safe:rotate-2');
    expect(taskCard).toContain('motion-safe:scale-105');
  });

  it('expands and collapses immediately with explicit accessible state', async () => {
    const user = userEvent.setup();
    renderWithProviders(<DashboardSection />);

    const toggle = screen.getByRole('button', { name: /Dashboard/ });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText('Dashboard content loaded')).toBeNull();

    await user.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('Dashboard content loaded')).toBeDefined();

    await user.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText('Dashboard content loaded')).toBeNull();
  });
});
