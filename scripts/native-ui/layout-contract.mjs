/* global document, getComputedStyle */

// Serializable renderer probe. This reads production CSS; it never repairs layout.
export function measurePageHeader() {
  const page = document.querySelector('[data-page-shell="primary"]');
  if (!page) return null;
  const rect = (el) => {
    if (!el) return null;
    const { x, y, width, height, right, bottom } = el.getBoundingClientRect();
    return { x, y, width, height, right, bottom };
  };
  const title = page.querySelector('h1');
  const back = page.querySelector('button[aria-label="Back"]');
  return {
    header: rect(page.querySelector('.primary-page-header')),
    title: rect(title),
    back: rect(back),
    content: rect(page.querySelector('.primary-page-content')),
    titleText: title?.textContent?.trim(),
    titleCount: document.querySelectorAll('h1').length,
    backText: back?.textContent?.trim(),
    fontSize: title ? parseFloat(getComputedStyle(title).fontSize) : null,
    lineHeight: title ? parseFloat(getComputedStyle(title).lineHeight) : null,
    boardRailControls: document.querySelectorAll(
      '[aria-label="Expand right sidebar"], [aria-label="Collapse right sidebar"]'
    ).length,
  };
}

const near = (actual, expected) => Number.isFinite(actual) && Math.abs(actual - expected) <= 1;
const measured = (r) =>
  r &&
  [r.x, r.y, r.width, r.height, r.right, r.bottom].every(Number.isFinite) &&
  r.width > 0 &&
  r.height > 0 &&
  near(r.right, r.x + r.width) &&
  near(r.bottom, r.y + r.height);
const contains = (outer, inner) =>
  inner.x >= outer.x - 1 &&
  inner.y >= outer.y - 1 &&
  inner.right <= outer.right + 1 &&
  inner.bottom <= outer.bottom + 1;

export function pageHeaderFailures(header, rem, expectedTitle, viewport) {
  if (!header || !['header', 'title', 'back', 'content'].every((key) => measured(header[key])))
    return ['missing primary header geometry'];
  const errors = [];
  if (
    !viewport ||
    ![viewport.width, viewport.height].every((n) => Number.isFinite(n) && n > 0) ||
    !contains({ x: 0, y: 0, right: viewport.width, bottom: viewport.height }, header.header) ||
    !contains(header.header, header.title) ||
    !contains(header.header, header.back)
  )
    errors.push('clipped primary heading/Back geometry');
  if (header.titleCount !== 1 || header.titleText !== expectedTitle || header.backText !== '')
    errors.push('invalid primary heading or Back control');
  if (header.boardRailControls !== 0) errors.push('context-invalid board rail control');
  if (
    !near(header.back.width, 2.5 * rem) ||
    !near(header.back.height, 2.5 * rem) ||
    !near(header.back.y - header.header.y, 0.125 * rem) ||
    !near(header.title.x - header.back.right, 0.75 * rem) ||
    !near(header.title.y, header.header.y) ||
    !near(header.fontSize, 1.5 * rem) ||
    !near(header.lineHeight, 2 * rem)
  )
    errors.push('inconsistent primary heading/Back geometry');
  return errors;
}

export function overlayInsetFailures(overlay, rem) {
  const errors = [];
  if (overlay.compound && !overlay.parts?.some((part) => part.insetKind === 'scroll'))
    errors.push('missing compound overlay scroll');
  for (const part of overlay.parts ?? []) {
    const units = {
      header: [0.625, 1, 0.625, 1],
      body: overlay.compound ? [0, 0, 0, 0] : [1, 1, 1, 1],
      footer: [1, 1, 1, 1],
      scroll: [1, 1, 1, 1],
      'task-header': [1, 1, 1, 1],
      'task-body': [0, 0, 0, 0],
    }[part.insetKind];
    if (
      !units ||
      !Array.isArray(part.padding) ||
      part.padding.length !== 4 ||
      !units.every((value, index) => near(part.padding[index], value * rem))
    )
      errors.push(`inconsistent overlay ${part.name} padding`);
  }
  return errors;
}
