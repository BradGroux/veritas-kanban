export interface RegisterPwaServiceWorkerOptions {
  enabled?: boolean;
  serviceWorker?: ServiceWorkerContainer;
  baseUrl?: string;
}

function normalizeBaseUrl(baseUrl: string): string {
  if (!baseUrl || baseUrl === '.') return './';
  return baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
}

export function resolvePwaAssetUrl(
  path: string,
  baseUrl = import.meta.env.BASE_URL || '/'
): string {
  const normalizedBase = normalizeBaseUrl(baseUrl);
  return `${normalizedBase}${path.replace(/^\//, '')}`;
}

export async function registerPwaServiceWorker(
  options: RegisterPwaServiceWorkerOptions = {}
): Promise<ServiceWorkerRegistration | null> {
  if (typeof window === 'undefined') return null;

  const serviceWorker = options.serviceWorker ?? navigator.serviceWorker;
  const enabled =
    options.enabled ?? (import.meta.env.PROD || import.meta.env.VITE_ENABLE_PWA === 'true');

  if (!enabled || !serviceWorker) {
    return null;
  }

  const baseUrl = normalizeBaseUrl(options.baseUrl ?? import.meta.env.BASE_URL ?? '/');
  const registration = await serviceWorker.register(resolvePwaAssetUrl('sw.js', baseUrl), {
    scope: baseUrl,
  });

  registration.update().catch((error) => {
    console.warn('[PWA] Service worker update check failed:', error);
  });

  return registration;
}
