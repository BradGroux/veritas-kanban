import { createRef } from 'react';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from './test-utils';
import { UiAction, UiIconAction } from '@/components/ui/UiVocabulary';
import { UiVocabularyGallery } from '@/components/ui/UiVocabularyGallery';
import { VERITAS_SEMANTIC_PALETTE } from '@/theme/ui-contract';

afterEach(cleanup);

function luminance(hex: string) {
  const channels = [1, 3, 5].map((offset) => {
    const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

describe('desktop UI vocabulary', () => {
  it('renders every action role, pill meaning, and surface level using production components', () => {
    const { container } = renderWithProviders(<UiVocabularyGallery />);
    for (const role of ['primary', 'secondary', 'quiet', 'destructive']) {
      expect(container.querySelector(`[data-ui-action="${role}"]`)).not.toBeNull();
    }
    for (const kind of ['neutral', 'count', 'selected', 'status']) {
      expect(container.querySelector(`[data-ui-pill="${kind}"]`)).not.toBeNull();
    }
    for (const level of ['section', 'card', 'inset', 'empty']) {
      expect(container.querySelector(`[data-ui-surface="${level}"]`)).not.toBeNull();
    }
    expect(screen.getByRole('button', { name: 'Disabled' }).hasAttribute('disabled')).toBe(true);
    expect(
      screen.getByRole('button', { name: 'Refresh gallery' }).hasAttribute('data-ui-icon-action')
    ).toBe(true);
  });

  it('preserves refs, native link semantics, keyboard activation, and disabled behavior', async () => {
    const click = vi.fn();
    const ref = createRef<HTMLButtonElement>();
    renderWithProviders(
      <>
        <UiAction ref={ref} onClick={click}>
          Save
        </UiAction>
        <UiAction disabled onClick={click}>
          Unavailable
        </UiAction>
        <UiAction component="a" href="#details" variant="quiet">
          Details
        </UiAction>
        <UiIconAction aria-label="Delete item" variant="destructive" onClick={click}>
          ×
        </UiIconAction>
      </>
    );
    expect(ref.current).toBe(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByRole('link', { name: 'Details' }).getAttribute('href')).toBe('#details');
    ref.current?.focus();
    await userEvent.keyboard('{Enter}');
    await userEvent.click(screen.getByRole('button', { name: 'Unavailable' }));
    expect(click).toHaveBeenCalledTimes(1);
  });

  it('keeps every semantic foreground above 4.5:1 and the rendered CSS palette in sync', () => {
    const css = readFileSync('src/globals.css', 'utf8');
    for (const [scheme, palette] of Object.entries(VERITAS_SEMANTIC_PALETTE)) {
      for (const [tone, swatch] of Object.entries(palette)) {
        const values = [luminance(swatch.foreground), luminance(swatch.background)].sort(
          (a, b) => b - a
        );
        expect((values[0] + 0.05) / (values[1] + 0.05), `${scheme}/${tone}`).toBeGreaterThanOrEqual(
          4.5
        );
        for (const [suffix, color] of [
          ['fg', swatch.foreground],
          ['bg', swatch.background],
          ['border', swatch.border],
        ]) {
          expect(css).toContain(`--vk-semantic-${tone}-${suffix}: ${color};`);
        }
      }
    }
  });
});
