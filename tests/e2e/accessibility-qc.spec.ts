import { test, expect } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';

test.describe('Accessibility Quality Control', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('should have no automatically detectable accessibility issues', async ({ page }) => {
    const accessibilityScanResults = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    
    expect(accessibilityScanResults.violations).toEqual([]);
  });

  test('should have proper keyboard navigation', async ({ page }) => {
    // Check focus management on interactive elements
    await page.keyboard.press('Tab');
    const firstFocusable = await page.locator('*:focus');
    await expect(firstFocusable).toBeVisible();
    
    // Check that focus moves through interactive elements
    await page.keyboard.press('Tab');
    const secondFocusable = await page.locator('*:focus');
    await expect(secondFocusable).toBeVisible();
  });

  test('should have sufficient color contrast', async ({ page }) => {
    const accessibilityScanResults = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa'])
      .include(['.text-primary', '.bg-primary', 'button', 'a'])
      .analyze();
    
    const contrastViolations = accessibilityScanResults.violations.filter(
      violation => violation.id === 'color-contrast'
    );
    
    expect(contrastViolations).toEqual([]);
  });

  test('should have proper focus indicators', async ({ page }) => {
    await page.keyboard.press('Tab');
    const focusedElement = await page.locator('*:focus');
    
    // Check that focused element has visible focus indicator
    const outlineWidth = await focusedElement.evaluate(el => {
      return window.getComputedStyle(el).outlineWidth;
    });
    
    expect(outlineWidth).not.toBe('0px');
  });

  test('should have accessible labels for form elements', async ({ page }) => {
    const accessibilityScanResults = await new AxeBuilder({ page })
      .withRules(['label'])
      .analyze();
    
    const labelViolations = accessibilityScanResults.violations.filter(
      violation => violation.id === 'label'
    );
    
    expect(labelViolations).toEqual([]);
  });

  test('should have proper heading structure', async ({ page }) => {
    const accessibilityScanResults = await new AxeBuilder({ page })
      .withRules(['heading-order'])
      .analyze();
    
    const headingViolations = accessibilityScanResults.violations.filter(
      violation => violation.id === 'heading-order'
    );
    
    expect(headingViolations).toEqual([]);
  });
});