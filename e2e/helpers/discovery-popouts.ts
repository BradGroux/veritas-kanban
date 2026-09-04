import { expect, type Locator, type Page } from '@playwright/test';

export async function installDiscoveryFixtures(page: Page) {
  const writes: string[] = [];
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    if (new URL(request.url()).pathname === '/api/search' && request.method() === 'POST') {
      const input = request.postDataJSON();
      expect(input.query).toBe('fixture');
      expect(input.backend).toBe('keyword');
      await route.fulfill({
        json: {
          query: input.query,
          backend: 'keyword',
          degraded: false,
          elapsedMs: 1,
          results: Array.from({ length: 20 }, (_, index) => ({
            id: `fixture-${index}`,
            title: `Fixture result ${index + 1}`,
            collection: 'policies',
            path: `policies/fixture-${index}`,
            snippet: 'Deterministic search evidence with a readable description.',
            score: 20 - index,
            metadata: {
              target:
                index === 0
                  ? { type: 'settings', section: 'tasks' }
                  : { type: 'view', view: 'policies' },
            },
          })),
        },
      });
    } else if (!['GET', 'HEAD'].includes(request.method())) {
      writes.push(`${request.method()} ${new URL(request.url()).pathname}`);
      await route.abort();
    } else await route.fallback();
  });
  return writes;
}

async function contained(dialog: Locator) {
  const geometry = await dialog.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const active = document.activeElement?.getBoundingClientRect();
    return {
      left: rect.left,
      right: rect.right,
      top: rect.top,
      bottom: rect.bottom,
      width: innerWidth,
      height: innerHeight,
      overflow: element.scrollWidth - element.clientWidth,
      focusVisible: !!active && active.top >= rect.top && active.bottom <= rect.bottom,
    };
  });
  expect(geometry.left).toBeGreaterThanOrEqual(0);
  expect(geometry.top).toBeGreaterThanOrEqual(0);
  expect(geometry.right).toBeLessThanOrEqual(geometry.width);
  expect(geometry.bottom).toBeLessThanOrEqual(geometry.height);
  expect(geometry.overflow).toBeLessThanOrEqual(1);
  expect(geometry.focusVisible).toBe(true);
}

export async function exerciseDiscoveryPopouts(
  page: Page,
  capture: (name: string) => Promise<void>
) {
  const paletteButton = page.getByRole('button', { name: /Command palette/ });
  const hasPaletteButton = await paletteButton.isVisible();
  const opener = hasPaletteButton
    ? paletteButton
    : page.getByRole('button', { name: 'Search', exact: true });
  const openPalette = async () => {
    if (hasPaletteButton) await opener.click();
    else {
      await opener.focus();
      await opener.press('Control+k');
    }
  };
  const palette = page.getByRole('dialog', { name: 'Command palette', exact: true });
  const input = palette.getByRole('textbox', { name: 'Search commands' });
  await openPalette();
  await expect(input).toBeFocused();
  await contained(palette);
  const scroll = palette.getByLabel('Available commands');
  const footer = palette.locator('.vk-overlay-footer');
  const footerBefore = await footer.boundingBox();
  for (let i = 0; i < 18; i++) await input.press('ArrowDown');
  await expect.poll(() => scroll.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  expect(await footer.boundingBox()).toEqual(footerBefore);
  await expect(palette.locator('[data-selected]')).toBeInViewport();
  await input.fill('restart local');
  await expect(palette.getByRole('button', { name: /Restart Local Server/ })).toHaveAttribute(
    'aria-disabled',
    'true'
  );
  await input.press('Enter');
  await expect(palette).toBeVisible();
  await input.fill('Universal Search');
  await capture('palette');
  await input.press('Enter');
  const search = page.getByRole('dialog', { name: 'Universal Search', exact: true });
  const query = search.getByRole('textbox', { name: 'Search Veritas' });
  await expect(query).toBeFocused();
  await expect(palette).toBeHidden();
  await contained(search);
  await query.fill('fixture');
  const backend = search.getByRole('combobox', { name: 'Search backend' });
  await backend.click();
  await page.getByRole('option', { name: 'Keyword', exact: true }).click();
  await backend.click();
  await backend.press('Escape');
  await expect(search).toBeVisible();
  await expect(backend).toBeFocused();
  await query.press('Enter');
  await expect(search.getByText('20 results from keyword')).toBeVisible();
  expect(await search.locator('.mantine-ScrollArea-root').count()).toBe(0);
  const last = search.getByRole('button', { name: /Fixture result 20/ });
  await last.focus();
  await expect(last).toBeInViewport();
  await contained(search);
  await capture('search');
  await last.press('Enter');
  await expect(search).toBeHidden();
  await expect(page).toHaveURL(/\/policies$/);

  await openPalette();
  await input.fill('Universal Search');
  await input.press('Enter');
  await expect(query).toBeFocused();
  await query.fill('fixture');
  await query.press('Enter');
  await search.getByRole('button', { name: /Fixture result 1\b/ }).press('Enter');
  const settingsFromSearch = page.getByRole('dialog', { name: 'Settings', exact: true });
  await expect(settingsFromSearch).toBeVisible();
  await expect
    .poll(() => settingsFromSearch.evaluate((element) => element.contains(document.activeElement)))
    .toBe(true);
  await page.keyboard.press('Escape');
  await expect(settingsFromSearch).toBeHidden();
  await expect(opener).toBeFocused();

  // Handoff to Settings and Create Task must not lose focus to the closing palette.
  for (const [command, destination] of [
    ['Open Settings', 'Settings'],
    ['New Task', 'Create New Task'],
  ]) {
    await openPalette();
    await input.fill(command);
    await input.press('Enter');
    const target = page.getByRole('dialog', { name: destination, exact: true });
    await expect(target).toBeVisible();
    await expect
      .poll(() => target.evaluate((element) => element.contains(document.activeElement)))
      .toBe(true);
    await page.keyboard.press('Escape');
    await expect(target).toBeHidden();
    await expect(opener).toBeFocused();
  }

  await openPalette();
  await input.press('Escape');
  await expect(palette).toBeHidden();
  await expect(opener).toBeFocused();
  // '?' is a board shortcut: use a non-editable focus target after returning to Board.
  await page.getByRole('button', { name: 'Board', exact: true }).click();
  await page.locator('main').focus();
  await page.keyboard.press('?');
  const help = page.getByRole('dialog', { name: 'Keyboard Shortcuts', exact: true });
  await expect(help).toBeVisible();
  await expect(help.getByRole('button', { name: 'Close dialog' })).toBeFocused();
  await contained(help);
  await help.getByRole('region', { name: 'General shortcuts' }).scrollIntoViewIfNeeded();
  await capture('shortcuts');
  await page.keyboard.press('Escape');
  await expect(help).toBeHidden();
  await expect(page.locator('main')).toBeFocused();
}
