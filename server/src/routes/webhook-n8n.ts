/**
 * webhook-n8n.ts
 *
 * Receives n8n email-directive payloads and optionally base64-encoded attachments.
 * Saves useful attachments (docx, pdf, txt) to the clawd inbox.
 *
 * POST /api/webhook/n8n
 * No auth required — routed BEFORE the authenticate middleware in index.ts.
 * Secured via shared webhook secret (N8N_WEBHOOK_SECRET env var).
 */
import { Router, Request, Response } from 'express';
import type { Router as RouterType } from 'express';
import fs from 'fs/promises';
import path from 'path';
import { asyncHandler } from '../middleware/async-handler.js';

const router: RouterType = Router();

const ALLOWED_MIME_TYPES = new Set([
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // docx
  'application/msword',
  'application/pdf',
  'text/plain',
  'text/csv',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // xlsx
]);

const ALLOWED_EXTENSIONS = new Set(['.docx', '.doc', '.pdf', '.txt', '.csv', '.xlsx']);

const ATTACHMENT_DIR =
  process.env.CLAWD_ATTACHMENT_DIR ||
  path.join(process.env.HOME || '/Users/bradgroux', 'clawd', 'inbox', 'attachments');

const WEBHOOK_SECRET = process.env.N8N_WEBHOOK_SECRET;

/**
 * POST /api/webhook/n8n
 * Body: { type: 'email-directive', from, subject, directive, messageId, timestamp, attachments? }
 * attachments: [{ filename, mimeType, data: '<base64>' }]
 */
router.post(
  '/n8n',
  asyncHandler(async (req: Request, res: Response) => {
    // Optional shared-secret check
    if (WEBHOOK_SECRET) {
      const provided = req.headers['x-webhook-secret'];
      if (provided !== WEBHOOK_SECRET) {
        res.status(401).json({ ok: false, error: 'Unauthorized' });
        return;
      }
    }

    const body = req.body as {
      type?: string;
      from?: string;
      subject?: string;
      directive?: string;
      forwardedContent?: string;
      messageId?: string;
      timestamp?: string;
      attachments?: Array<{ filename: string; mimeType: string; data: string }>;
    };

    if (body.type !== 'email-directive') {
      res.status(400).json({ ok: false, error: `Unknown type: ${body.type}` });
      return;
    }

    // Ensure attachment dir exists
    await fs.mkdir(ATTACHMENT_DIR, { recursive: true });

    const saved: string[] = [];
    const skipped: string[] = [];

    for (const att of body.attachments || []) {
      const ext = path.extname(att.filename).toLowerCase();
      if (!ALLOWED_EXTENSIONS.has(ext) && !ALLOWED_MIME_TYPES.has(att.mimeType)) {
        skipped.push(att.filename);
        continue;
      }

      // Sanitize filename
      const safeName = att.filename.replace(/[^a-zA-Z0-9._\-() ]/g, '_');
      const ts = new Date(body.timestamp || Date.now())
        .toISOString()
        .replace(/[:.]/g, '-')
        .slice(0, 19);
      const destName = `${ts}_${body.from?.split('@')[0] || 'unknown'}_${safeName}`;
      const destPath = path.join(ATTACHMENT_DIR, destName);

      await fs.writeFile(destPath, Buffer.from(att.data, 'base64'));
      saved.push(destName);
    }

    // Write a sidecar .json summary for each email-directive
    const metaName = `${new Date(body.timestamp || Date.now())
      .toISOString()
      .replace(/[:.]/g, '-')
      .slice(0, 19)}_${body.from?.split('@')[0] || 'unknown'}_directive.json`;
    await fs.writeFile(
      path.join(ATTACHMENT_DIR, metaName),
      JSON.stringify(
        {
          type: 'email-directive',
          from: body.from,
          subject: body.subject,
          directive: body.directive,
          messageId: body.messageId,
          timestamp: body.timestamp,
          savedAttachments: saved,
          skippedAttachments: skipped,
        },
        null,
        2
      )
    );

    res.json({
      ok: true,
      saved,
      skipped,
      meta: metaName,
    });
  })
);

export { router as webhookN8nRouter };
