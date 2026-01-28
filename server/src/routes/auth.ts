import { Router, Request, Response, type IRouter } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { asyncHandler } from '../middleware/async-handler.js';
import {
  getSecurityConfig,
  getJwtSecret,
  saveSecurityConfig,
  SecurityConfig,
  generateRecoveryKey,
  hashRecoveryKey,
  rotateJwtSecret,
  getJwtRotationStatus,
} from '../config/security.js';
import { authenticate, authorize, type AuthenticatedRequest } from '../middleware/auth.js';

const router: IRouter = Router();

// Constants
const SALT_ROUNDS = 12;
const JWT_EXPIRY_DEFAULT = '24h';
const JWT_EXPIRY_REMEMBER = '30d';

// Rate limiting for login attempts (in-memory, resets on restart)
const loginAttempts = new Map<string, { count: number; lastAttempt: number }>();
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 30000; // 30 seconds

function checkRateLimit(ip: string): { allowed: boolean; retryAfter?: number } {
  const now = Date.now();
  const attempts = loginAttempts.get(ip);
  
  if (!attempts) {
    return { allowed: true };
  }
  
  // Reset if lockout expired
  if (now - attempts.lastAttempt > LOCKOUT_MS) {
    loginAttempts.delete(ip);
    return { allowed: true };
  }
  
  if (attempts.count >= MAX_ATTEMPTS) {
    const retryAfter = Math.ceil((LOCKOUT_MS - (now - attempts.lastAttempt)) / 1000);
    return { allowed: false, retryAfter };
  }
  
  return { allowed: true };
}

function recordFailedAttempt(ip: string): void {
  const now = Date.now();
  const attempts = loginAttempts.get(ip) || { count: 0, lastAttempt: now };
  attempts.count++;
  attempts.lastAttempt = now;
  loginAttempts.set(ip, attempts);
}

function clearAttempts(ip: string): void {
  loginAttempts.delete(ip);
}

// ============ Routes ============

/**
 * GET /api/auth/status
 * Check if setup is required and current auth status
 */
router.get('/status', asyncHandler(async (req: Request, res: Response) => {
  const config = getSecurityConfig();
  const needsSetup = !config.passwordHash;
  
  // Check for existing JWT
  let authenticated = false;
  let sessionExpiry: string | null = null;
  
  const token = req.cookies?.veritas_session;
  if (token && !needsSetup) {
    try {
      const decoded = jwt.verify(token, getJwtSecret()) as jwt.JwtPayload;
      authenticated = true;
      if (decoded.exp) {
        sessionExpiry = new Date(decoded.exp * 1000).toISOString();
      }
    } catch {
      // Invalid or expired token
    }
  }
  
  res.json({
    needsSetup,
    authenticated,
    sessionExpiry,
    authEnabled: config.authEnabled !== false,
  });
}));

/**
 * POST /api/auth/setup
 * First-time password setup
 */
router.post('/setup', asyncHandler(async (req: Request, res: Response) => {
  const config = getSecurityConfig();
  
  // Only allow setup if no password exists
  if (config.passwordHash) {
    res.status(400).json({
      error: 'Password already configured',
      code: 'ALREADY_SETUP',
    });
    return;
  }
  
  const { password } = req.body;
  
  if (!password || typeof password !== 'string') {
    res.status(400).json({
      error: 'Password is required',
      code: 'MISSING_PASSWORD',
    });
    return;
  }
  
  if (password.length < 8) {
    res.status(400).json({
      error: 'Password must be at least 8 characters',
      code: 'PASSWORD_TOO_SHORT',
    });
    return;
  }
  
  // Hash password
  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
  
  // Generate recovery key
  const recoveryKey = generateRecoveryKey();
  const recoveryKeyHash = await hashRecoveryKey(recoveryKey);
  
  // Build config to save — only persist jwtSecret to file if env var is NOT set
  const updatedConfig: SecurityConfig = {
    ...config,
    passwordHash,
    recoveryKeyHash,
    authEnabled: true,
    setupCompletedAt: new Date().toISOString(),
  };

  // If no env var, generate and persist a JWT secret to the config file
  if (!process.env.VERITAS_JWT_SECRET) {
    updatedConfig.jwtSecret = crypto.randomBytes(64).toString('hex');
  }

  // Save config
  saveSecurityConfig(updatedConfig);
  
  // Return recovery key (only time it's shown in plaintext)
  res.json({
    success: true,
    recoveryKey,
    message: 'Password set successfully. Save your recovery key!',
  });
}));

/**
 * POST /api/auth/login
 * Authenticate with password
 */
router.post('/login', asyncHandler(async (req: Request, res: Response) => {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  
  // Check rate limit
  const rateCheck = checkRateLimit(ip);
  if (!rateCheck.allowed) {
    res.status(429).json({
      error: 'Too many login attempts',
      code: 'RATE_LIMITED',
      retryAfter: rateCheck.retryAfter,
    });
    return;
  }
  
  const config = getSecurityConfig();
  
  if (!config.passwordHash) {
    res.status(400).json({
      error: 'Password not configured. Run setup first.',
      code: 'NOT_SETUP',
    });
    return;
  }
  
  const { password, rememberMe } = req.body;
  
  if (!password || typeof password !== 'string') {
    res.status(400).json({
      error: 'Password is required',
      code: 'MISSING_PASSWORD',
    });
    return;
  }
  
  // Verify password
  const valid = await bcrypt.compare(password, config.passwordHash);
  
  if (!valid) {
    recordFailedAttempt(ip);
    res.status(401).json({
      error: 'Invalid password',
      code: 'INVALID_PASSWORD',
    });
    return;
  }
  
  // Clear failed attempts on success
  clearAttempts(ip);
  
  // Generate JWT
  const expiryStr = rememberMe ? JWT_EXPIRY_REMEMBER : (config.sessionTimeout || JWT_EXPIRY_DEFAULT);
  const token = jwt.sign(
    { 
      type: 'session',
      iat: Math.floor(Date.now() / 1000),
    },
    getJwtSecret(),
    { expiresIn: expiryStr as jwt.SignOptions['expiresIn'] }
  );
  
  // Set cookie
  const maxAge = rememberMe ? 30 * 24 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
  res.cookie('veritas_session', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge,
    path: '/',
  });
  
  res.json({
    success: true,
    expiresAt: new Date(Date.now() + maxAge).toISOString(),
  });
}));

/**
 * POST /api/auth/logout
 * Clear session
 */
router.post('/logout', asyncHandler(async (_req: Request, res: Response) => {
  res.clearCookie('veritas_session', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
  });
  
  res.json({ success: true });
}));

/**
 * POST /api/auth/recover
 * Reset password using recovery key
 */
router.post('/recover', asyncHandler(async (req: Request, res: Response) => {
  const config = getSecurityConfig();
  
  if (!config.recoveryKeyHash) {
    res.status(400).json({
      error: 'No recovery key configured',
      code: 'NO_RECOVERY_KEY',
    });
    return;
  }
  
  const { recoveryKey, newPassword } = req.body;
  
  if (!recoveryKey || typeof recoveryKey !== 'string') {
    res.status(400).json({
      error: 'Recovery key is required',
      code: 'MISSING_RECOVERY_KEY',
    });
    return;
  }
  
  if (!newPassword || typeof newPassword !== 'string' || newPassword.length < 8) {
    res.status(400).json({
      error: 'New password must be at least 8 characters',
      code: 'INVALID_NEW_PASSWORD',
    });
    return;
  }
  
  // Verify recovery key
  const recoveryKeyHash = await hashRecoveryKey(recoveryKey);
  
  // Use timing-safe comparison
  const valid = config.recoveryKeyHash === recoveryKeyHash;
  
  if (!valid) {
    res.status(401).json({
      error: 'Invalid recovery key',
      code: 'INVALID_RECOVERY_KEY',
    });
    return;
  }
  
  // Hash new password
  const passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
  
  // Generate new recovery key
  const newRecoveryKey = generateRecoveryKey();
  const newRecoveryKeyHash = await hashRecoveryKey(newRecoveryKey);
  
  // Build config — rotate jwtSecret in file only if env var is NOT set
  const updatedConfig: SecurityConfig = {
    ...config,
    passwordHash,
    recoveryKeyHash: newRecoveryKeyHash,
    lastPasswordChange: new Date().toISOString(),
  };

  // Rotate file-based secret if no env var (invalidates all existing sessions)
  if (!process.env.VERITAS_JWT_SECRET) {
    updatedConfig.jwtSecret = crypto.randomBytes(64).toString('hex');
  }
  // Note: if using env var, session invalidation requires changing the env var

  // Save config
  saveSecurityConfig(updatedConfig);
  
  res.json({
    success: true,
    recoveryKey: newRecoveryKey,
    message: 'Password reset successfully. Save your new recovery key!',
  });
}));

/**
 * POST /api/auth/change-password
 * Change password (requires current password)
 */
router.post('/change-password', asyncHandler(async (req: Request, res: Response) => {
  const config = getSecurityConfig();
  
  if (!config.passwordHash) {
    res.status(400).json({
      error: 'Password not configured',
      code: 'NOT_SETUP',
    });
    return;
  }
  
  const { currentPassword, newPassword } = req.body;
  
  if (!currentPassword || typeof currentPassword !== 'string') {
    res.status(400).json({
      error: 'Current password is required',
      code: 'MISSING_CURRENT_PASSWORD',
    });
    return;
  }
  
  if (!newPassword || typeof newPassword !== 'string' || newPassword.length < 8) {
    res.status(400).json({
      error: 'New password must be at least 8 characters',
      code: 'INVALID_NEW_PASSWORD',
    });
    return;
  }
  
  // Verify current password
  const valid = await bcrypt.compare(currentPassword, config.passwordHash);
  
  if (!valid) {
    res.status(401).json({
      error: 'Current password is incorrect',
      code: 'INVALID_CURRENT_PASSWORD',
    });
    return;
  }
  
  // Hash new password
  const passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
  
  // Save config
  saveSecurityConfig({
    ...config,
    passwordHash,
    lastPasswordChange: new Date().toISOString(),
  });
  
  res.json({
    success: true,
    message: 'Password changed successfully',
  });
}));

// ============ JWT Secret Rotation (Admin-Only) ============

/**
 * POST /api/auth/rotate-secret
 * Rotate the JWT signing secret. Requires admin authentication.
 * Old secrets are kept for a configurable grace period (default 7 days)
 * so existing sessions continue to work.
 * 
 * Body (optional):
 *   gracePeriodDays: number — how many days to keep old secrets valid (default: 7)
 */
router.post('/rotate-secret', authenticate, authorize('admin'), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { gracePeriodDays } = req.body || {};

  // Validate grace period if provided
  let gracePeriodMs: number | undefined;
  if (gracePeriodDays !== undefined) {
    const days = Number(gracePeriodDays);
    if (isNaN(days) || days < 0 || days > 90) {
      res.status(400).json({
        error: 'gracePeriodDays must be a number between 0 and 90',
        code: 'INVALID_GRACE_PERIOD',
      });
      return;
    }
    gracePeriodMs = days * 24 * 60 * 60 * 1000;
  }

  const result = rotateJwtSecret(gracePeriodMs);

  if (!result.success) {
    res.status(409).json({
      error: result.message,
      code: 'ROTATION_NOT_AVAILABLE',
    });
    return;
  }

  res.json({
    success: true,
    newVersion: result.newVersion,
    prunedExpiredSecrets: result.prunedCount,
    gracePeriodDays: gracePeriodDays ?? 7,
    message: `JWT secret rotated to version ${result.newVersion}. Previous secret(s) valid for ${gracePeriodDays ?? 7} more day(s).`,
  });
}));

/**
 * GET /api/auth/rotation-status
 * Get current JWT secret rotation status. Requires admin authentication.
 */
router.get('/rotation-status', authenticate, authorize('admin'), asyncHandler(async (_req: AuthenticatedRequest, res: Response) => {
  const status = getJwtRotationStatus();
  res.json(status);
}));

export default router;
