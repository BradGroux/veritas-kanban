import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, unlink } from 'node:fs/promises';
import path from 'node:path';
import type { KnowledgePage } from '@veritas-kanban/shared';
import { withFileLock } from '../services/file-lock.js';
import { getRuntimeDir } from '../utils/paths.js';
import { digestRunLaunchValue } from '../utils/run-launch-manifest-digest.js';
import { ensureWithinBase } from '../utils/sanitize.js';
import { atomicWriteFile } from './fs-helpers.js';

export interface KnowledgeQmdProjection {
  collectionName: string;
  configDir: string;
  directory: string;
  changed: boolean;
}

export class KnowledgeQmdProjectionStore {
  constructor(private readonly baseDir = path.join(getRuntimeDir(), 'knowledge-qmd')) {
    ensureWithinBase(path.dirname(this.baseDir), this.baseDir);
  }

  async sync(
    workspaceId: string,
    collectionId: string,
    pages: KnowledgePage[]
  ): Promise<KnowledgeQmdProjection> {
    const key = createHash('sha256')
      .update(`${workspaceId}\0${collectionId}`)
      .digest('hex')
      .slice(0, 24);
    const directory = ensureWithinBase(this.baseDir, path.join(this.baseDir, 'collections', key));
    const configDir = ensureWithinBase(this.baseDir, path.join(this.baseDir, 'config'));
    const manifestPath = ensureWithinBase(directory, path.join(directory, 'manifest.json'));
    const collectionName = `vk-knowledge-${key}`;
    const digest = digestRunLaunchValue(
      pages
        .map((page) => ({ id: page.id, digest: page.digest }))
        .sort((left, right) => left.id.localeCompare(right.id))
    );

    await mkdir(directory, { recursive: true });
    await mkdir(configDir, { recursive: true });
    return withFileLock(manifestPath, async () => {
      const existingDigest = await readManifestDigest(manifestPath);
      if (existingDigest === digest) {
        return { collectionName, configDir, directory, changed: false };
      }
      const desiredFiles = new Set(pages.map((page) => `${page.id}.md`));
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        if (entry.isFile() && entry.name.endsWith('.md') && !desiredFiles.has(entry.name)) {
          const stalePath = ensureWithinBase(directory, path.join(directory, entry.name));
          await unlink(stalePath);
        }
      }
      for (const page of pages) {
        const filePath = ensureWithinBase(directory, path.join(directory, `${page.id}.md`));
        await atomicWriteFile(filePath, renderPage(page));
      }
      await atomicWriteFile(
        manifestPath,
        `${JSON.stringify({ schemaVersion: 'knowledge-qmd-projection/v1', digest }, null, 2)}\n`
      );
      return { collectionName, configDir, directory, changed: true };
    });
  }
}

async function readManifestDigest(filePath: string): Promise<string | null> {
  try {
    const parsed = JSON.parse(await readFile(filePath, 'utf8')) as {
      schemaVersion?: unknown;
      digest?: unknown;
    };
    return parsed.schemaVersion === 'knowledge-qmd-projection/v1' &&
      typeof parsed.digest === 'string'
      ? parsed.digest
      : null;
  } catch {
    return null;
  }
}

function renderPage(page: KnowledgePage): string {
  const revision = page.current;
  return [
    '---',
    `veritasPageId: ${JSON.stringify(page.id)}`,
    `stableKey: ${JSON.stringify(page.stableKey)}`,
    `title: ${JSON.stringify(revision.title)}`,
    `pageKind: ${JSON.stringify(revision.pageKind)}`,
    `reviewState: ${JSON.stringify(revision.reviewState)}`,
    `sourceIds: ${JSON.stringify([
      ...new Set(
        revision.claims.flatMap((claim) => claim.citations.map((citation) => citation.sourceId))
      ),
    ])}`,
    '---',
    '',
    revision.markdown,
    '',
    ...revision.claims.map((claim) => `> ${claim.text}`),
    '',
  ].join('\n');
}
