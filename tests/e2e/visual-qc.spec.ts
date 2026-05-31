import { test, expect } from '@playwright/test';

test.describe('Visual Quality Control Tests', () => {
  [
    { name: 'Board View', path: '/' },
    { name: 'Task Detail', path: '/task/1' },
    { name: 'Create Task', path: '/create-task' },
  ].forEach(({ name, path }) => {
    ['light', 'dark'].forEach((theme) => {
      ['desktop', 'tablet', 'mobile'].forEach((viewport) => {
        test(`${name} - ${theme} mode - ${viewport}`, async ({ page }) => {
          // Set viewport
          switch (viewport) {
            case 'mobile':
              await page.setViewportSize({ width: 375, height: 667 });
              break;
            case 'tablet':
              await page.setViewportSize({ width: 768, height: 1024 });
              break;
            default: // desktop
              await page.setViewportSize({ width: 1280, height: 800 });
          }

          // Set theme
          await page.addInitScript((theme) => {
            window.localStorage.setItem('theme', theme);
          }, theme);

          // Navigate to page
          await page.goto(path);
          
          // Wait for page to load
          await page.waitForLoadState('networkidle');
          
          // Take screenshot
          await expect(page).toHaveScreenshot({
            fullPage: true,
            maxDiffPixelRatio: 0.01
          });
        });
      });
    });
  });
});