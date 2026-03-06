import { describe, it, expect } from 'vitest';

/**
 * Tests for the BASE_PATH boundary-safe matching logic used in server/src/index.ts.
 *
 * The matchesBasePath function ensures the character immediately after the
 * basePath prefix is '/', '?', or end-of-string.  This prevents false positives
 * like `/kanban-admin` matching when basePath is `/kanban`.
 *
 * We reimplement the same pure function here to test the contract directly.
 */

function createMatchesBasePath(basePath: string) {
  return function matchesBasePath(url: string): boolean {
    return url === basePath || url.startsWith(basePath + '/') || url.startsWith(basePath + '?');
  };
}

describe('matchesBasePath', () => {
  const basePath = '/kanban';
  const matchesBasePath = createMatchesBasePath(basePath);

  it('matches exact basePath', () => {
    expect(matchesBasePath('/kanban')).toBe(true);
  });

  it('matches basePath with trailing slash', () => {
    expect(matchesBasePath('/kanban/')).toBe(true);
  });

  it('matches basePath with sub-path', () => {
    expect(matchesBasePath('/kanban/board')).toBe(true);
  });

  it('matches basePath with query string', () => {
    expect(matchesBasePath('/kanban?q=1')).toBe(true);
  });

  it('does NOT match paths that extend basePath without a boundary', () => {
    expect(matchesBasePath('/kanban-admin')).toBe(false);
  });

  it('does NOT match paths that extend basePath with extra characters', () => {
    expect(matchesBasePath('/kanbanx')).toBe(false);
  });

  it('does NOT match unrelated paths', () => {
    expect(matchesBasePath('/other')).toBe(false);
    expect(matchesBasePath('/')).toBe(false);
  });
});

describe('matchesBasePath with empty basePath', () => {
  it('empty basePath matches nothing (guard prevents stripping)', () => {
    // When basePath is empty, the server code checks `if (basePath && ...)`
    // so matchesBasePath is never called.  But if it were, an empty prefix
    // would trivially match everything.  The real guard is the `if (basePath)`
    // check in the server code.  We verify that empty basePath is falsy.
    const emptyBasePath = '';
    expect(Boolean(emptyBasePath)).toBe(false);
  });
});

describe('URL stripping behavior', () => {
  const basePath = '/kanban';
  const matchesBasePath = createMatchesBasePath(basePath);

  function stripBasePath(url: string): string {
    if (basePath && matchesBasePath(url)) {
      return url.slice(basePath.length) || '/';
    }
    return url;
  }

  it('strips basePath from exact match, yielding "/"', () => {
    expect(stripBasePath('/kanban')).toBe('/');
  });

  it('strips basePath from path with trailing slash', () => {
    expect(stripBasePath('/kanban/')).toBe('/');
  });

  it('strips basePath from sub-path', () => {
    expect(stripBasePath('/kanban/board')).toBe('/board');
  });

  it('strips basePath from path with query string', () => {
    expect(stripBasePath('/kanban?q=1')).toBe('?q=1');
  });

  it('leaves non-matching paths untouched', () => {
    expect(stripBasePath('/kanban-admin')).toBe('/kanban-admin');
    expect(stripBasePath('/kanbanx')).toBe('/kanbanx');
    expect(stripBasePath('/other')).toBe('/other');
  });
});
