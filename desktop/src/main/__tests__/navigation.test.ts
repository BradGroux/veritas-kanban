import { describe, expect, it, vi } from 'vitest';
import type { IpcMainInvokeEvent, Shell, WebContents } from 'electron';

import {
  hasSameOriginNavigation,
  isOwnedDesktopSender,
  openValidatedExternalUrl,
} from '../navigation.js';

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

  it('accepts only an owned main frame at the app origin, with a separate generated-status-page exception', () => {
    const owner = {
      mainFrame: { url: 'http://127.0.0.1:3000/?desktop-settings=1' },
      isDestroyed: () => false,
      getURL: () => 'data:text/html,status',
    } as unknown as WebContents;
    const event = { sender: owner, senderFrame: owner.mainFrame } as IpcMainInvokeEvent;
    expect(isOwnedDesktopSender(event, [owner], 'http://127.0.0.1:3000')).toBe(true);
    expect(
      isOwnedDesktopSender(
        { ...event, senderFrame: { url: owner.mainFrame.url } } as IpcMainInvokeEvent,
        [owner],
        'http://127.0.0.1:3000'
      )
    ).toBe(false);
    expect(isOwnedDesktopSender(event, [], 'http://127.0.0.1:3000')).toBe(false);
    expect(isOwnedDesktopSender(event, [owner], 'http://127.0.0.1:4000')).toBe(false);
    Object.assign(owner.mainFrame, { url: 'data:text/html,status' });
    expect(isOwnedDesktopSender(event, [owner], 'http://127.0.0.1:3000')).toBe(false);
    expect(isOwnedDesktopSender(event, [owner], 'http://127.0.0.1:3000', owner)).toBe(true);
    Object.assign(owner.mainFrame, { url: 'data:text/html,unrecognized' });
    expect(isOwnedDesktopSender(event, [owner], 'http://127.0.0.1:3000', owner)).toBe(false);
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
