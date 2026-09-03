import { StrictMode, useState } from 'react';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { UiModal, UiDrawer, OVERLAY_VARIANTS, OverlayFooter } from '@/components/ui/UiOverlay';
import { renderWithProviders } from './test-utils';

afterEach(cleanup);

describe('shared popout contract', () => {
  it('restores the outer opener when a nested subtree unmounts in StrictMode', async () => {
    function Probe() {
      const [open, setOpen] = useState(false);
      const [child, setChild] = useState(false);
      return (
        <>
          <button onClick={() => setOpen(true)}>Outer opener</button>
          {open && (
            <UiModal opened onClose={() => setOpen(false)} title="Parent">
              <button onClick={() => setChild(true)}>Child opener</button>
              {child && (
                <UiModal opened onClose={() => setChild(false)} title="Child">
                  <button onClick={() => setOpen(false)}>Close subtree</button>
                </UiModal>
              )}
            </UiModal>
          )}
        </>
      );
    }
    renderWithProviders(
      <StrictMode>
        <Probe />
      </StrictMode>
    );
    const opener = screen.getByRole('button', { name: 'Outer opener' });
    vi.spyOn(opener, 'getClientRects').mockReturnValue([
      new DOMRect(0, 0, 100, 32),
    ] as unknown as DOMRectList);
    opener.focus();
    fireEvent.click(opener);
    const childOpener = screen.getByRole('button', { name: 'Child opener' });
    childOpener.focus();
    fireEvent.click(childOpener);
    fireEvent.click(screen.getByRole('button', { name: 'Close subtree' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(opener));
  });
  it.each(Object.keys(OVERLAY_VARIANTS) as (keyof typeof OVERLAY_VARIANTS)[])(
    'labels and exposes the %s geometry',
    (variant) => {
      renderWithProviders(
        <UiModal opened onClose={() => {}} title={`${variant} example`} variant={variant}>
          <p>Body</p>
        </UiModal>
      );
      const dialog = screen.getByRole('dialog', { name: `${variant} example` });
      expect(dialog.closest('[data-overlay-variant]')?.getAttribute('data-overlay-variant')).toBe(
        variant
      );
      expect(screen.getByRole('button', { name: 'Close dialog' }).getAttribute('title')).toBe(
        'Close'
      );
    }
  );

  it('only closes the top nested popout and reactivates the parent after unmount', async () => {
    const closeParent = vi.fn();
    function Probe() {
      const [child, setChild] = useState(false);
      return (
        <UiModal opened onClose={closeParent} title="Parent">
          <button onClick={() => setChild(true)}>Open child</button>
          {child && (
            <UiModal opened onClose={() => setChild(false)} title="Child">
              <input aria-label="Child field" />
            </UiModal>
          )}
        </UiModal>
      );
    }
    renderWithProviders(<Probe />);
    fireEvent.click(screen.getByRole('button', { name: 'Open child' }));
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Child field' }), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Child' })).toBeNull());
    expect(closeParent).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByRole('button', { name: 'Open child' }), { key: 'Escape' });
    expect(closeParent).toHaveBeenCalledOnce();
  });

  it('respects an explicit Escape guard and uses a dialog for a nested utility panel', () => {
    const close = vi.fn();
    renderWithProviders(
      <UiModal opened onClose={() => {}} title="Parent">
        <UiDrawer opened onClose={close} closeOnEscape={false} title="Nested preview" compound>
          <div className="vk-overlay-scroll">Preview</div>
          <OverlayFooter>Actions</OverlayFooter>
        </UiDrawer>
      </UiModal>
    );
    expect(
      screen
        .getByRole('dialog', { name: 'Nested preview' })
        .closest('[data-overlay-presentation]')
        ?.getAttribute('data-overlay-presentation')
    ).toBe('dialog');
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(close).not.toHaveBeenCalled();
  });
});
