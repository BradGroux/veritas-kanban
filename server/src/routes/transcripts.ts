/**
 * Transcripts Route
 *
 * POST /api/transcripts/dedup-check
 *
 * Simple folder-based duplicate transcript check.
 * Rule: if a normalized subject exists in processed/ -> it's a duplicate.
 *       if only in top-level inbox/transcripts/ or not present -> it's new.
 *
 * Called by n8n Email Ingestion Engine (Transcript Dedup Check node).
 * n8n code nodes cannot access the filesystem directly; this endpoint bridges the gap.
 */
import { Router } from 'express';
import { readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { createLogger } from '../lib/logger.js';
import { asyncHandler } from '../middleware/async-handler.js';

const log = createLogger('transcripts');
const router = Router();

const TRANSCRIPT_DIR = join(
  homedir(),
  'Library/Mobile Documents/com~apple~CloudDocs/Brain/engram/inbox/transcripts'
);
const PROCESSED_DIR = join(TRANSCRIPT_DIR, 'processed');

/**
 * Normalize a transcript name / email subject so minor variations don't cause mismatches.
 * Strips common prefixes, punctuation, whitespace; lowercases.
 */
function normalizeTranscriptName(value: string): string {
  return value
    .toLowerCase()
    .replace(/^(re:|fw:|fwd:)\s*/g, '')
    .replace(/[_\-–—]/g, ' ')
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Check whether a given subject/filename is already present in processed/.
 */
function isProcessed(subject: string): { found: boolean; matchedFile: string | null } {
  if (!existsSync(PROCESSED_DIR)) {
    return { found: false, matchedFile: null };
  }

  const needle = normalizeTranscriptName(subject);
  let files: string[] = [];
  try {
    files = readdirSync(PROCESSED_DIR);
  } catch {
    return { found: false, matchedFile: null };
  }

  for (const file of files) {
    const normalizedFile = normalizeTranscriptName(file.replace(/\.(txt|md|docx)$/, ''));
    if (
      normalizedFile === needle ||
      normalizedFile.includes(needle) ||
      needle.includes(normalizedFile)
    ) {
      if (needle.length >= 10) {
        // Require at least 10 chars to avoid spurious substring matches
        return { found: true, matchedFile: file };
      }
    }
  }

  return { found: false, matchedFile: null };
}

/**
 * POST /api/transcripts/dedup-check
 * Body: { subject: string, emailId?: string }
 * Returns: { transcriptMatchFound: boolean, matchedFile: string|null }
 */
router.post(
  '/dedup-check',
  asyncHandler(async (req, res) => {
    const { subject, emailId } = req.body ?? {};

    if (!subject || typeof subject !== 'string') {
      res.status(400).json({ error: 'subject is required' });
      return;
    }

    const result = isProcessed(subject);

    log.info(
      `dedup-check subject="${subject}" emailId=${emailId ?? '(none)'} found=${result.found} match=${result.matchedFile ?? 'none'}`
    );

    res.json({
      transcriptMatchFound: result.found,
      matchedFile: result.matchedFile,
    });
  })
);

export { router as transcriptRoutes };
