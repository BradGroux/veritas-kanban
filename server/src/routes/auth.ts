import { Router, Request, Response, type IRouter } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { z } from 'zod';
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
import { auditLog } from '../services/audit-service.js';

const router: IRouter = Router();

// Validation schemas
const setupSchema = z.object({
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

const loginSchema = z.object({
  password: z.string().min(1, 'Password is required'),
  rememberMe: z.boolean().optional(),
});

const recoverSchema = z.object({
  recoveryKey: z.string().min(1, 'Recovery key is required'),
  newPassword: z.string().min(8, 'New password must be at least 8 characters'),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword: z.string().min(8, 'New password must be at least 8 characters'),
});

const rotateSecretSchema = z
  .object({
    gracePeriodDays: z.number().min(0).max(90).optional(),
  })
  .optional()
  .default({});

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
 * @openapi
 * /api/auth/status:
 *   get:
 *     summary: Check auth status
 *     description: Check whether initial setup is required and whether the current session is authenticated.
 *     tags: [Auth]
 *     security: []
 *     responses:
 *       200:
 *         description: Auth status
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 needsSetup: { type: boolean, description: 'True if no password has been set yet' }
 *                 authenticated: { type: boolean, description: 'True if current session is valid' }
 *                 sessionExpiry: { type: string, format: date-time, nullable: true }
 *                 authEnabled: { type: boolean }
 */
router.get(
  '/status',
  asyncHandler(async (req: Request, res: Response) => {
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
  })
);

/**
 * @openapi
 * /api/auth/setup:
 *   post:
 *     summary: First-time password setup
 *     description: >
 *       Set the initial admin password. Only allowed when no password has been configured yet.
 *       Returns a recovery key that should be saved securely (only shown once).
 *     tags: [Auth]
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/AuthSetupInput'
 *     responses:
 *       200:
 *         description: Password set successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 recoveryKey: { type: string, description: 'One-time recovery key — save it!' }
 *                 message: { type: string }
 *       400:
 *         description: Password already configured or invalid input
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.post(
  '/setup',
  asyncHandler(async (req: Request, res: Response) => {
    const config = getSecurityConfig();

    // Only allow setup if no password exists
    if (config.passwordHash) {
      res.status(400).json({
        error: 'Password already configured',
        code: 'ALREADY_SETUP',
      });
      return;
    }

    // Validate request body with Zod
    const parseResult = setupSchema.safeParse(req.body);
    if (!parseResult.success) {
      const firstError = parseResult.error.issues[0];
      const isPasswordMissing = !req.body?.password || typeof req.body.password !== 'string';
      res.status(400).json({
        error: firstError.message,
        code: isPasswordMissing ? 'MISSING_PASSWORD' : 'PASSWORD_TOO_SHORT',
        details: parseResult.error.issues.map((e) => ({
          path: e.path.join('.'),
          message: e.message,
        })),
      });
      return;
    }

    const { password } = parseResult.data;

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
  })
);

/**
 * @openapi
 * /api/auth/login:
 *   post:
 *     summary: Login with password
 *     description: >
 *       Authenticate with the admin password. On success, sets an httpOnly session cookie.
 *       Rate-limited to 5 attempts per 30 seconds per IP.
 *     tags: [Auth]
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/LoginInput'
 *     responses:
 *       200:
 *         description: Login successful — session cookie set
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 expiresAt: { type: string, format: date-time }
 *       400:
 *         description: Password not configured
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       401:
 *         description: Invalid password
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       429:
 *         description: Rate limited — too many login attempts
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error: { type: string }
 *                 code: { type: string }
 *                 retryAfter: { type: number, description: 'Seconds until retry is allowed' }
 */
router.post(
  '/login',
  asyncHandler(async (req: Request, res: Response) => {
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

    // Validate request body with Zod
    const loginParsed = loginSchema.safeParse(req.body);
    if (!loginParsed.success) {
      res.status(400).json({
        error: 'Password is required',
        code: 'MISSING_PASSWORD',
        details: loginParsed.error.issues.map((e) => ({
          path: e.path.join('.'),
          message: e.message,
        })),
      });
      return;
    }

    const { password, rememberMe } = loginParsed.data;

    // Verify password
    const valid = await bcrypt.compare(password, config.passwordHash);

    if (!valid) {
      recordFailedAttempt(ip);
      await auditLog({
        action: 'auth.failed',
        actor: 'anonymous',
        details: { ip, userAgent: req.headers['user-agent'] },
      });
      res.status(401).json({
        error: 'Invalid password',
        code: 'INVALID_PASSWORD',
      });
      return;
    }

    // Clear failed attempts on success
    clearAttempts(ip);

    // Generate JWT
    const expiryStr = rememberMe
      ? JWT_EXPIRY_REMEMBER
      : config.sessionTimeout || JWT_EXPIRY_DEFAULT;
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

    await auditLog({
      action: 'auth.login',
      actor: 'admin',
      details: { ip, userAgent: req.headers['user-agent'], rememberMe: !!rememberMe },
    });

    res.json({
      success: true,
      expiresAt: new Date(Date.now() + maxAge).toISOString(),
    });
  })
);

/**
 * POST /api/auth/logout
 * Clear session
 */
router.post(
  '/logout',
  asyncHandler(async (req: Request, res: Response) => {
    res.clearCookie('veritas_session', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/',
    });

    await auditLog({
      action: 'auth.logout',
      actor: 'admin',
      details: { ip: req.ip || req.socket.remoteAddress },
    });

    res.json({ success: true });
  })
);

/**
 * POST /api/auth/recover
 * Reset password using recovery key
 */
router.post(
  '/recover',
  asyncHandler(async (req: Request, res: Response) => {
    const config = getSecurityConfig();

    if (!config.recoveryKeyHash) {
      res.status(400).json({
        error: 'No recovery key configured',
        code: 'NO_RECOVERY_KEY',
      });
      return;
    }

    // Validate request body with Zod
    const recoverParsed = recoverSchema.safeParse(req.body);
    if (!recoverParsed.success) {
      const firstError = recoverParsed.error.issues[0];
      const isRecoveryKeyMissing =
        !req.body?.recoveryKey || typeof req.body.recoveryKey !== 'string';
      res.status(400).json({
        error: firstError.message,
        code: isRecoveryKeyMissing ? 'MISSING_RECOVERY_KEY' : 'INVALID_NEW_PASSWORD',
        details: recoverParsed.error.issues.map((e) => ({
          path: e.path.join('.'),
          message: e.message,
        })),
      });
      return;
    }

    const { recoveryKey, newPassword } = recoverParsed.data;

    // Verify recovery key
    const recoveryKeyHash = await hashRecoveryKey(recoveryKey);

    // Timing-safe comparison to prevent side-channel attacks
    const storedBuf = Buffer.from(config.recoveryKeyHash, 'hex');
    const inputBuf = Buffer.from(recoveryKeyHash, 'hex');
    const valid =
      storedBuf.length === inputBuf.length && crypto.timingSafeEqual(storedBuf, inputBuf);

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
  })
);

/**
 * POST /api/auth/change-password
 * Change password (requires current password)
 */
router.post(
  '/change-password',
  asyncHandler(async (req: Request, res: Response) => {
    const config = getSecurityConfig();

    if (!config.passwordHash) {
      res.status(400).json({
        error: 'Password not configured',
        code: 'NOT_SETUP',
      });
      return;
    }

    // Validate request body with Zod
    const changeParsed = changePasswordSchema.safeParse(req.body);
    if (!changeParsed.success) {
      const firstError = changeParsed.error.issues[0];
      const isCurrentMissing =
        !req.body?.currentPassword || typeof req.body.currentPassword !== 'string';
      res.status(400).json({
        error: firstError.message,
        code: isCurrentMissing ? 'MISSING_CURRENT_PASSWORD' : 'INVALID_NEW_PASSWORD',
        details: changeParsed.error.issues.map((e) => ({
          path: e.path.join('.'),
          message: e.message,
        })),
      });
      return;
    }

    const { currentPassword, newPassword } = changeParsed.data;

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
  })
);

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
router.post(
  '/rotate-secret',
  authenticate,
  authorize('admin'),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    // Validate request body with Zod
    const rotateParsed = rotateSecretSchema.safeParse(req.body || {});
    if (!rotateParsed.success) {
      res.status(400).json({
        error: 'gracePeriodDays must be a number between 0 and 90',
        code: 'INVALID_GRACE_PERIOD',
        details: rotateParsed.error.issues.map((e) => ({
          path: e.path.join('.'),
          message: e.message,
        })),
      });
      return;
    }

    const { gracePeriodDays } = rotateParsed.data;

    let gracePeriodMs: number | undefined;
    if (gracePeriodDays !== undefined) {
      gracePeriodMs = gracePeriodDays * 24 * 60 * 60 * 1000;
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
  })
);

/**
 * GET /api/auth/rotation-status
 * Get current JWT secret rotation status. Requires admin authentication.
 */
router.get(
  '/rotation-status',
  authenticate,
  authorize('admin'),
  asyncHandler(async (_req: AuthenticatedRequest, res: Response) => {
    const status = getJwtRotationStatus();
    res.json(status);
  })
);

export default router;
