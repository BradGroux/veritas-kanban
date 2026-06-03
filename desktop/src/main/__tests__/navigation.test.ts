import { describe, expect, it, vi } from 'vitest';
import type { Shell } from 'electron';

import { hasSameOriginNavigation, openValidatedExternalUrl } from '../navigation.js';

function shell(): Shell {
  return {
    openExternal: vi.fn(async () => undefined),
  } as unknown as Shell;
}

describe('desktop navigation guards', () => {
  it('compares parsed origins instead of string prefixes', () => {
    expect(hasSameOriginNavigation('http://127.0.0.1:3000/tasks', 'http://127.0.0.1:3000')).toBe(
      true
    );
    expect(
      hasSameOriginNavigation(
        'http://127.0.0.1:3000@attacker.example/tasks',
        'http://127.0.0.1:3000'
      )
    ).toBe(false);
    expect(hasSameOriginNavigation('not a url', 'http://127.0.0.1:3000')).toBe(false);
  });

  it('reuses the safe external URL validator before opening OS handlers', async () => {
    const fakeShell = shell();

    await expect(openValidatedExternalUrl(fakeShell, 'https://example.com/docs')).resolves.toBe(
      true
    );
    await expect(
      openValidatedExternalUrl(fakeShell, 'file:///Users/bradgroux/.ssh/id_ed25519')
    ).resolves.toBe(false);
    await expect(
      openValidatedExternalUrl(fakeShell, 'https://user:pass@example.com')
    ).resolves.toBe(false);

    expect(fakeShell.openExternal).toHaveBeenCalledTimes(1);
    expect(fakeShell.openExternal).toHaveBeenCalledWith('https://example.com/docs');
  });
});
