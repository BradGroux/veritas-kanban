import { describe, expect, it } from 'vitest';
import { veritasMantineTheme } from '@/theme/mantine-theme';

describe('veritasMantineTheme', () => {
  it('keeps overlay scroll locking disabled for CSP-safe packaged desktop modals', () => {
    expect(veritasMantineTheme.components?.Modal?.defaultProps).toMatchObject({
      lockScroll: false,
    });
    expect(veritasMantineTheme.components?.Drawer?.defaultProps).toMatchObject({
      lockScroll: false,
    });
  });

  it('gives shared overlays one bounded scroll owner', () => {
    expect(veritasMantineTheme.components?.Modal?.styles).toMatchObject({
      content: {
        minHeight: 0,
        overflow: 'hidden',
      },
      body: {
        minHeight: 0,
        overflowY: 'auto',
        overscrollBehavior: 'contain',
      },
    });
    expect(veritasMantineTheme.components?.Drawer?.styles).toMatchObject({
      content: {
        minHeight: 0,
        overflow: 'hidden',
      },
      body: {
        minHeight: 0,
        overflowY: 'auto',
        overscrollBehavior: 'contain',
      },
    });
    expect(veritasMantineTheme.components?.Popover?.styles).toMatchObject({
      dropdown: {
        overflowY: 'auto',
        overscrollBehavior: 'contain',
      },
    });
  });
});
