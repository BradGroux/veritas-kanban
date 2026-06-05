import type { NextFunction, Response } from 'express';
import type { AuthenticatedRequest, AuthContext } from './auth.js';
import { ForbiddenError, UnauthorizedError } from './error-handler.js';

const LOCAL_AGENT_CAPABILITIES = new Set([
  'desktop:local',
  'agent:run:local',
  'agent:run:unrestricted',
  'local-agent:run',
]);

const LOCAL_CLIENT_MODES = new Set(['desktop-local', 'cli']);

export function authAllowsLocalAgentControls(auth: AuthContext | undefined): boolean {
  if (!auth) return false;
  if (auth.authMethod === 'localhost-bypass') return true;
  if (auth.isLocalhost) return true;
  if (auth.capabilities?.some((capability) => LOCAL_AGENT_CAPABILITIES.has(capability))) {
    return true;
  }

  return !!auth.clientMode && LOCAL_CLIENT_MODES.has(auth.clientMode);
}

export function requireLocalAgentCapability(
  req: AuthenticatedRequest,
  _res: Response,
  next: NextFunction
): void {
  if (!req.auth) {
    return next(new UnauthorizedError());
  }

  if (!authAllowsLocalAgentControls(req.auth)) {
    return next(
      new ForbiddenError('Local agent controls are disabled for this session', {
        requiredCapabilities: [...LOCAL_AGENT_CAPABILITIES],
        allowedClientModes: [...LOCAL_CLIENT_MODES],
        clientMode: req.auth.clientMode ?? 'remote',
        authMethod: req.auth.authMethod,
      })
    );
  }

  next();
}
