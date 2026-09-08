/* global document, getComputedStyle */
import assert from 'node:assert/strict';
import { expect } from '@playwright/test';

export async function measureTextContrast(locator) {
  return locator.evaluate((element) => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    const rgba = (color) => {
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = color;
      context.fillRect(0, 0, 1, 1);
      return [...context.getImageData(0, 0, 1, 1).data];
    };
    const blend = (front, back) =>
      front
        .slice(0, 3)
        .map((value, index) => (value * front[3]) / 255 + back[index] * (1 - front[3] / 255));
    const ancestors = [];
    for (let node = element; node; node = node.parentElement) ancestors.unshift(node);
    let background = [255, 255, 255];
    for (const node of ancestors)
      background = blend(rgba(getComputedStyle(node).backgroundColor), background);
    const style = getComputedStyle(element);
    const foreground = blend(rgba(style.color), background);
    const luminance = (rgb) =>
      rgb
        .map((value) => {
          const v = value / 255;
          return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
        })
        .reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
    const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
    return {
      text: element.textContent.trim().slice(0, 80),
      foreground,
      background,
      ratio: (values[0] + 0.05) / (values[1] + 0.05),
      outline: style.outline,
      shadow: style.boxShadow,
    };
  });
}

export async function verifyRouteContrast(page, route) {
  const targets = [];
  const primary = page.getByRole('button', { name: 'New Task', exact: true });
  targets.push(['primary-action', primary]);
  if (route === 'drift')
    targets.push(['selected-filter', page.getByRole('button', { name: 'all', exact: true })]);
  if (route === 'operations') {
    const code = page.locator('main code').first();
    await expect(code).toBeVisible(); // Requires the real seeded blocked task, never an empty-state pass.
    targets.push(['task-id', code]);
  }
  const results = [];
  for (const [label, target] of targets) {
    await expect(target).toBeVisible();
    for (const state of label === 'task-id' ? ['normal'] : ['normal', 'hover', 'focus']) {
      if (state === 'hover') await target.hover();
      if (state === 'focus') {
        await page.mouse.move(0, 0);
        await target.focus();
      }
      const measured = await measureTextContrast(target);
      assert(measured.ratio >= 4.5, `${route}/${label}/${state}: ${measured.ratio.toFixed(2)}:1`);
      results.push({ label, state, ...measured });
    }
  }
  return results;
}
