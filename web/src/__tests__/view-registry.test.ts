import { describe, expect, it } from 'vitest';

import {
  NAVIGATION_VIEWS,
  VIEW_BY_ID,
  VIEW_DEFINITIONS,
  VIEW_PATHS,
  type AppView,
} from '@/lib/views';

describe('view registry', () => {
  it('keeps view ids, paths, and ordering unique', () => {
    const viewIds = VIEW_DEFINITIONS.map((definition) => definition.view);
    const paths = VIEW_DEFINITIONS.map((definition) => definition.path);
    const orders = VIEW_DEFINITIONS.map((definition) => definition.order);

    expect(new Set(viewIds).size).toBe(viewIds.length);
    expect(new Set(paths).size).toBe(paths.length);
    expect(new Set(orders).size).toBe(orders.length);
    expect(orders).toEqual([...orders].sort((a, b) => a - b));
  });

  it('derives path and id lookups from the shared definitions', () => {
    for (const definition of VIEW_DEFINITIONS) {
      expect(VIEW_BY_ID[definition.view as AppView]).toBe(definition);
      expect(VIEW_PATHS[definition.view as AppView]).toBe(definition.path);
    }
  });

  it('requires every visible navigation view to declare a lazy loader and label metadata', () => {
    const expectedNavigationViews = VIEW_DEFINITIONS.filter(
      (definition) => definition.showInNavigation && definition.view !== 'board'
    );

    expect(NAVIGATION_VIEWS).toEqual(expectedNavigationViews);
    for (const definition of NAVIGATION_VIEWS) {
      expect(definition.label).toBeTruthy();
      expect(definition.commandLabel).toContain(definition.label);
      expect(typeof definition.loadComponent).toBe('function');
    }
  });
});
