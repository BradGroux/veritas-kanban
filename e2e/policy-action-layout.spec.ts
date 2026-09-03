import { expect, test } from '@playwright/test';
import { bypassAuth, cleanupRoutes } from './helpers/auth';

for (const theme of ['light', 'dark']) {
  test(`policy actions retain whole labels and open the correct dialogs (${theme})`, async ({
    page,
  }, testInfo) => {
    await bypassAuth(page);
    await page.addInitScript(() => {
      window.localStorage.setItem('veritas.desktop.leftRailOpen', 'false');
      Object.defineProperty(window, 'veritasDesktop', {
        configurable: true,
        value: { onMenuCommand: () => () => undefined },
      });
    });
    await page.goto('/policies');
    await expect(page.getByRole('button', { name: 'Edit', exact: true }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Edit', exact: true })).toHaveCount(3);
    for (const width of [1360, 1180]) {
      await page.setViewportSize({ width, height: 760 });
      for (const fontSize of [16, 20]) {
        await page.evaluate(
          ({ theme, fontSize }) => {
            document.documentElement.style.fontSize = `${fontSize}px`;
            document.documentElement.dataset.mantineColorScheme = theme;
            document.documentElement.classList.toggle('dark', theme === 'dark');
          },
          { theme, fontSize }
        );
        for (const sidebar of ['open', 'closed']) {
          const toggle = page.getByRole('button', { name: /^(Expand|Collapse) left sidebar$/ });
          if ((await toggle.getAttribute('aria-expanded')) !== String(sidebar === 'open'))
            await toggle.click();
          for (const label of await page.getByText('Risk Threshold', { exact: true }).all()) {
            const geometry = await label.evaluate((element) => ({
              height: element.getBoundingClientRect().height,
              lineHeight: parseFloat(getComputedStyle(element).lineHeight),
            }));
            expect(geometry.height).toBeLessThanOrEqual(geometry.lineHeight * 2 + 8);
          }
          for (const name of ['Edit', 'Test']) {
            for (const button of await page.getByRole('button', { name, exact: true }).all()) {
              const geometry = await button.evaluate((element) => {
                const label = element.querySelector('.mantine-Button-label')!;
                const bounds = label.getBoundingClientRect();
                const font = parseFloat(getComputedStyle(label).fontSize);
                return {
                  height: bounds.height,
                  font,
                  buttonHeight: element.getBoundingClientRect().height,
                  labelWidth: label.clientWidth,
                  labelScrollWidth: label.scrollWidth,
                };
              });
              expect(geometry.height, `${name} label at ${width}/${fontSize}`).toBeLessThan(
                geometry.font * 2
              );
              expect(geometry.buttonHeight).toBeLessThan(fontSize * 3);
              expect(geometry.labelScrollWidth).toBeLessThanOrEqual(geometry.labelWidth + 1);
            }
          }
        }
      }
    }
    await page.screenshot({ path: testInfo.outputPath(`policy-${theme}.png`) });
    const edit = page.getByRole('button', { name: 'Edit', exact: true }).first();
    await edit.click();
    await expect(page.getByRole('dialog')).toContainText('Edit Policy');
    await page.keyboard.press('Escape');
    await expect(edit).toBeFocused();
    const preview = page.getByRole('button', { name: 'Test', exact: true }).first();
    await preview.click();
    await expect(page.getByRole('dialog')).toContainText('Test Policy');
    await page.keyboard.press('Escape');
    await expect(preview).toBeFocused();
    await cleanupRoutes(page);
  });
}
