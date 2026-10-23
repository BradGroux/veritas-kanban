import type { Request, Response, NextFunction, RequestHandler } from 'express';
import type { IncomingMessage, ServerResponse } from 'http';
import helmet from 'helmet';
import { cspNonceDirective } from '../middleware/csp-nonce.js';

type CspDirectiveValue = string | ((_req: IncomingMessage, res: ServerResponse) => string);

export type CspDirectives = Record<string, null | Iterable<CspDirectiveValue>>;

export interface CspDirectiveOptions {
  isDev: boolean;
  isDesktopRuntime: boolean;
  isSecureRequest: boolean;
  reportUri?: string | null;
}

export interface SecurityHeadersOptions {
  isDev: boolean;
  isDesktopRuntime: boolean;
  reportOnly: boolean;
  reportUri?: string | null;
}

const SELF = "'self'";
const NONE = "'none'";
const UNSAFE_INLINE = "'unsafe-inline'";

/**
 * Production style policy intentionally avoids broad style-src unsafe-inline.
 *
 * Runtime React/Mantine surfaces still use dynamic style attributes for layout,
 * progress bars, drag/drop transforms, and color indicators, so the remaining
 * inline-style exception is narrowed to style-src-attr. Inline <style> elements
 * must be same-origin stylesheet assets or carry the per-request nonce.
 */
export function buildCspDirectives(options: CspDirectiveOptions): CspDirectives {
  const nonceDirective = cspNonceDirective();
  const scriptSrc = options.isDev ? [SELF, UNSAFE_INLINE] : [SELF, nonceDirective];
  const styleElementSrc = options.isDev ? [SELF, UNSAFE_INLINE] : [SELF, nonceDirective];
  const directives: CspDirectives = {
    defaultSrc: [SELF],
    scriptSrc,
    styleSrc: styleElementSrc,
    styleSrcElem: styleElementSrc,
    styleSrcAttr: [UNSAFE_INLINE],
    connectSrc: [
      SELF,
      'ws://localhost:*',
      'ws://127.0.0.1:*',
      ...(options.isDev ? ['http://localhost:*', 'http://127.0.0.1:*'] : []),
    ],
    imgSrc: [SELF, 'data:', 'blob:'],
    fontSrc: [SELF],
    objectSrc: [NONE],
    frameSrc: [NONE],
    baseUri: [SELF],
    formAction: [SELF],
    upgradeInsecureRequests:
      options.isDev || options.isDesktopRuntime || !options.isSecureRequest ? null : [],
  };

  if (options.reportUri) {
    directives.reportUri = [options.reportUri];
  }

  return directives;
}

/**
 * Applies the production upgrade policy only to requests that Express identifies
 * as HTTPS. With TRUST_PROXY configured, req.secure also reflects a trusted
 * X-Forwarded-Proto header from the deployment's reverse proxy.
 */
export function createSecurityHeaders(options: SecurityHeadersOptions): RequestHandler {
  const createHeaders = (isSecureRequest: boolean) =>
    helmet({
      contentSecurityPolicy: {
        reportOnly: options.reportOnly,
        directives: {
          ...buildCspDirectives({
            isDev: options.isDev,
            isDesktopRuntime: options.isDesktopRuntime,
            isSecureRequest,
            reportUri: options.reportUri,
          }),
        },
      },
      // Cross-Origin-Embedder-Policy can break loading of cross-origin resources;
      // disable it for now since we serve an API, not embedded content.
      crossOriginEmbedderPolicy: false,
    });

  const plaintextHeaders = createHeaders(false);
  const secureHeaders = createHeaders(true);

  return (req, res, next) => (req.secure ? secureHeaders : plaintextHeaders)(req, res, next);
}

export function apiDocsCspOverride(_req: Request, res: Response, next: NextFunction): void {
  res.removeHeader('Content-Security-Policy');
  res.removeHeader('Content-Security-Policy-Report-Only');
  next();
}
