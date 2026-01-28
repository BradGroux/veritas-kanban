import { test, expect } from '@playwright/test';
import { bypassAuth } from './helpers/auth';

test.describe('Settings', () => {
  test.beforeEach(async ({ page }) => {
    await bypassAuth(page);
  });

  test('settings dialog opens from header', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('header')).toBeVisible();

    // Click the settings button (gear icon)
    const settingsBtn = page.locator('header button:has(svg.lucide-settings)');
    await settingsBtn.click();

    // Settings dialog should open — verify by the dialog title heading
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 5_000 });
    await expect(dialog.getByRole('heading', { name: 'Settings' })).toBeVisible();
  });

  test('settings dialog shows tab navigation', async ({ page }) => {
    await page.goto('/');

    // Open settings
    const settingsBtn = page.locator('header button:has(svg.lucide-settings)');
    await settingsBtn.click();

    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    // Verify tab buttons are present (they're in a sidebar nav with role="tab")
    await expect(dialog.getByRole('tab', { name: 'General' })).toBeVisible();
    await expect(dialog.getByRole('tab', { name: 'Board' })).toBeVisible();
    await expect(dialog.getByRole('tab', { name: 'Tasks' })).toBeVisible();
    await expect(dialog.getByRole('tab', { name: 'Agents' })).toBeVisible();
  });

  test('switch to Board tab and toggle a setting', async ({ page }) => {
    await page.goto('/');

    // Open settings
    const settingsBtn = page.locator('header button:has(svg.lucide-settings)');
    await settingsBtn.click();

    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    // Click on the Board tab
    await dialog.getByRole('tab', { name: 'Board' }).click();

    // The Board tab should show display options
    await expect(dialog.locator('text=Board & Display')).toBeVisible({ timeout: 3_000 });

    // Verify a setting exists — "Show Dashboard" toggle
    await expect(dialog.getByText('Show Dashboard').first()).toBeVisible();

    // Find the "Show Dashboard" toggle switch (Switch component with aria-label)
    const toggle = dialog.getByRole('switch', { name: 'Show Dashboard' });
    
    // Get the current state
    const initialState = await toggle.getAttribute('data-state');
    const expectedNewState = initialState === 'checked' ? 'unchecked' : 'checked';
    
    // Click to toggle
    await toggle.click();
    
    // Wait for the state to change (may be debounced)
    await expect(toggle).toHaveAttribute('data-state', expectedNewState, { timeout: 3_000 });
  });

  test('settings dialog closes on escape', async ({ page }) => {
    await page.goto('/');

    const settingsBtn = page.locator('header button:has(svg.lucide-settings)');
    await settingsBtn.click();

    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    // Press Escape to close
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible({ timeout: 3_000 });
  });

  test('card density setting has expected options', async ({ page }) => {
    await page.goto('/');

    // Open settings, navigate to Board tab
    const settingsBtn = page.locator('header button:has(svg.lucide-settings)');
    await settingsBtn.click();

    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    await dialog.getByRole('tab', { name: 'Board' }).click();
    await expect(dialog.getByText('Card Density').first()).toBeVisible({ timeout: 3_000 });

    // The Card Density uses a Radix Select — find the trigger within the setting row
    // The row structure: div > div(label) + div(select trigger)
    const cardDensityTrigger = dialog.locator('button[role="combobox"]').filter({ hasText: /Normal|Compact/ });
    await cardDensityTrigger.click();

    // Verify the dropdown options appear (Radix portals them to body)
    await expect(page.getByRole('option', { name: 'Normal' })).toBeVisible({ timeout: 3_000 });
    await expect(page.getByRole('option', { name: 'Compact' })).toBeVisible();
  });
});
