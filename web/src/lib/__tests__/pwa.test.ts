import { describe, expect, it, vi } from 'vitest';
import { registerPwaServiceWorker, resolvePwaAssetUrl } from '@/lib/pwa';

describe('pwa helpers', () => {
  it('resolves service-worker assets relative to the configured base path', () => {
    expect(resolvePwaAssetUrl('sw.js', '/')).toBe('/sw.js');
    expect(resolvePwaAssetUrl('/sw.js', '/kanban')).toBe('/kanban/sw.js');
  });

  it('skips registration when PWA support is disabled', async () => {
    const register = vi.fn();

    const result = await registerPwaServiceWorker({
      enabled: false,
      serviceWorker: { register } as unknown as ServiceWorkerContainer,
    });

    expect(result).toBeNull();
    expect(register).not.toHaveBeenCalled();
  });

  it('registers the service worker under the app base path', async () => {
    const update = vi.fn().mockResolvedValue(undefined);
    const registration = { update } as unknown as ServiceWorkerRegistration;
    const register = vi.fn().mockResolvedValue(registration);

    const result = await registerPwaServiceWorker({
      enabled: true,
      baseUrl: '/kanban/',
      serviceWorker: { register } as unknown as ServiceWorkerContainer,
    });

    expect(result).toBe(registration);
    expect(register).toHaveBeenCalledWith('/kanban/sw.js', { scope: '/kanban/' });
    expect(update).toHaveBeenCalled();
  });
});
