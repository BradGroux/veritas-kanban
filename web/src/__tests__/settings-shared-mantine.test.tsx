import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { SectionHeader, SettingRow, ToggleRow } from '@/components/settings/shared';
import { renderWithProviders } from './test-utils';

describe('Settings shared Mantine rows', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders setting rows with direct Mantine layout and text primitives', () => {
    const { container } = renderWithProviders(
      <SettingRow label="Example setting" description="Helpful context">
        <span>Control</span>
      </SettingRow>
    );

    expect(screen.getByText('Example setting')).toBeDefined();
    expect(screen.getByText('Helpful context')).toBeDefined();
    expect(container.querySelector('.mantine-Group-root')).toBeDefined();
    expect(container.querySelector('.mantine-Text-root')).toBeDefined();
  });

  it('renders toggles through Mantine Switch and preserves checked changes', () => {
    const onCheckedChange = vi.fn();
    const { container } = renderWithProviders(
      <ToggleRow label="Enable feature" checked={false} onCheckedChange={onCheckedChange} />
    );

    expect(container.querySelector('.mantine-Switch-root')).toBeDefined();

    fireEvent.click(screen.getByRole('switch', { name: 'Enable feature' }));

    expect(onCheckedChange).toHaveBeenCalledWith(true);
  });

  it('renders section reset actions through Mantine Button', () => {
    const { container } = renderWithProviders(<SectionHeader title="Board" onReset={vi.fn()} />);

    expect(screen.getByText('Board')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Reset' })).toBeDefined();
    expect(container.querySelector('.mantine-Button-root')).toBeDefined();
  });
});
