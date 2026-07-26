import { createHash } from 'node:crypto';
import type {
  KnowledgeCollection,
  KnowledgeFreshnessRule,
  KnowledgeIntegrityFinding,
  KnowledgeIntegrityFindingKind,
  KnowledgeIntegrityReport,
  KnowledgeIntegritySeverity,
  KnowledgeLaunchContext,
  KnowledgePage,
  KnowledgePageClaim,
  KnowledgeSource,
} from '@veritas-kanban/shared';
import { digestRunLaunchValue } from '../utils/run-launch-manifest-digest.js';

export interface KnowledgeSourceIntegrityInput {
  source: KnowledgeSource;
  content: string | null;
  integrityError: boolean;
}

export interface KnowledgeIntegrityLintOptions {
  collection: KnowledgeCollection;
  pages: KnowledgePage[];
  sources: KnowledgeSourceIntegrityInput[];
  asOf: string;
  freshnessRules: KnowledgeFreshnessRule[];
  includeResearchCandidates: boolean;
  launchContext?: KnowledgeLaunchContext;
}

export function lintKnowledgeCollection(
  options: KnowledgeIntegrityLintOptions
): KnowledgeIntegrityReport {
  const findings: KnowledgeIntegrityFinding[] = [];
  const pagesById = new Map(options.pages.map((page) => [page.id, page]));
  const sourcesById = new Map(options.sources.map((entry) => [entry.source.id, entry]));
  const identityOwners = new Map<string, string[]>();
  const asOfMs = Date.parse(options.asOf);

  for (const page of options.pages) {
    for (const identity of [page.stableKey, ...page.current.aliases]) {
      const normalized = normalizeIdentity(identity);
      identityOwners.set(normalized, [...(identityOwners.get(normalized) ?? []), page.id]);
    }
  }

  for (const [identity, owners] of identityOwners) {
    if (new Set(owners).size > 1) {
      findings.push(
        finding('duplicate-identity', 'error', 'A page identity is owned by multiple pages.', {
          relatedIds: [identity, ...new Set(owners)],
        })
      );
    }
  }

  for (const page of options.pages) {
    const revision = page.current;
    if (!options.collection.definition.pageKinds.includes(revision.pageKind)) {
      findings.push(
        finding('invalid-page-kind', 'error', 'The page kind is not allowed by the collection.', {
          pageId: page.id,
          relatedIds: [revision.pageKind],
        })
      );
    }
    const missingMetadata = options.collection.definition.requiredMetadata.filter(
      (key) => !revision.metadata[key]?.trim()
    );
    if (missingMetadata.length > 0) {
      findings.push(
        finding('missing-metadata', 'error', 'The page is missing required metadata.', {
          pageId: page.id,
          relatedIds: missingMetadata,
        })
      );
    }
    for (const linkedId of revision.outgoingPageIds) {
      const linked = pagesById.get(linkedId);
      if (!linked) {
        findings.push(
          finding('broken-link', 'error', 'An outgoing page link has no readable target.', {
            pageId: page.id,
            relatedIds: [linkedId],
          })
        );
      } else if (!linked.current.backlinkPageIds.includes(page.id)) {
        findings.push(
          finding('backlink-drift', 'error', 'An outgoing link is missing its reverse backlink.', {
            pageId: page.id,
            relatedIds: [linkedId],
          })
        );
      }
    }
    for (const backlinkId of revision.backlinkPageIds) {
      const backlink = pagesById.get(backlinkId);
      if (!backlink || !backlink.current.outgoingPageIds.includes(page.id)) {
        findings.push(
          finding('backlink-drift', 'error', 'A backlink has no matching outgoing link.', {
            pageId: page.id,
            relatedIds: [backlinkId],
          })
        );
      }
    }
    if (revision.outgoingPageIds.length === 0 && revision.backlinkPageIds.length === 0) {
      findings.push(
        finding('orphan-page', 'warning', 'The page has no incoming or outgoing page links.', {
          pageId: page.id,
        })
      );
    }
    for (const claim of revision.claims) {
      lintClaim(findings, page, claim, sourcesById);
    }
    lintPageFreshness(findings, page, options.freshnessRules, asOfMs);
    if (
      options.includeResearchCandidates &&
      revision.markdown
        .split('\n')
        .some((line) => line.trim().length > 3 && line.trim().endsWith('?'))
    ) {
      findings.push(
        finding(
          'unanswered-question',
          'info',
          'The page contains an unanswered question that may need research.',
          { pageId: page.id }
        )
      );
    }
  }

  for (const entry of options.sources) {
    if (entry.integrityError) {
      findings.push(
        finding(
          'changed-source-hash',
          'error',
          'The retained source content no longer matches its immutable hash.',
          { sourceId: entry.source.id }
        )
      );
    }
    lintSourceFreshness(findings, entry.source, options.freshnessRules, asOfMs);
  }

  if (options.includeResearchCandidates) {
    lintCanonicalTerms(findings, options.pages, identityOwners);
  }

  findings.sort(compareFindings);
  const inspected = {
    pages: options.pages.length,
    sources: options.sources.length,
    claims: options.pages.reduce((total, page) => total + page.current.claims.length, 0),
  };
  const findingCounts: Record<KnowledgeIntegritySeverity, number> = {
    info: findings.filter((entry) => entry.severity === 'info').length,
    warning: findings.filter((entry) => entry.severity === 'warning').length,
    error: findings.filter((entry) => entry.severity === 'error').length,
  };
  const payload = {
    schemaVersion: 'knowledge-integrity-report/v1' as const,
    workspaceId: options.collection.workspaceId,
    collectionId: options.collection.id,
    asOf: options.asOf,
    ...(options.launchContext ? { launchContext: options.launchContext } : {}),
    inspected,
    findings,
    findingCounts,
  };
  return { ...payload, reportDigest: digestRunLaunchValue(payload) };
}

function lintClaim(
  findings: KnowledgeIntegrityFinding[],
  page: KnowledgePage,
  claim: KnowledgePageClaim,
  sourcesById: Map<string, KnowledgeSourceIntegrityInput>
): void {
  if (claim.citations.length === 0) {
    findings.push(
      finding('uncited-claim', 'error', 'A material claim has no source citation.', {
        pageId: page.id,
        claimId: claim.id,
      })
    );
    return;
  }
  for (const citation of claim.citations) {
    const source = sourcesById.get(citation.sourceId);
    if (!source) {
      findings.push(
        finding(
          'inaccessible-source',
          'error',
          'A claim citation does not resolve inside the current access scope.',
          {
            pageId: page.id,
            claimId: claim.id,
            relatedIds: [citation.sourceId],
          }
        )
      );
      continue;
    }
    if (citation.locator && !locatorExists(source.source, source.content, citation.locator)) {
      findings.push(
        finding(
          'invalid-citation-locator',
          'error',
          'A citation locator does not resolve in the retained source.',
          {
            pageId: page.id,
            sourceId: source.source.id,
            claimId: claim.id,
          }
        )
      );
    }
  }
}

function locatorExists(
  source: KnowledgeSource,
  content: string | null,
  locator: KnowledgePageClaim['citations'][number]['locator']
): boolean {
  if (!locator || content === null) return true;
  if (locator.kind === 'line-range') {
    return locator.startLine >= 1 && locator.endLine <= content.split('\n').length;
  }
  if (locator.kind === 'heading') {
    const headings = content
      .split('\n')
      .filter((line) => /^#{1,6}\s+/.test(line))
      .map((line) => line.replace(/^#{1,6}\s+/, '').trim());
    return (
      headings.filter((heading) => heading === locator.heading).length >= (locator.occurrence ?? 1)
    );
  }
  if (locator.kind === 'json-pointer') {
    if (!source.mediaType.includes('json')) return false;
    try {
      let value: unknown = JSON.parse(content);
      for (const segment of locator.pointer
        .split('/')
        .slice(1)
        .map((part) => part.replace(/~1/g, '/').replace(/~0/g, '~'))) {
        if (!value || typeof value !== 'object' || !(segment in value)) return false;
        value = (value as Record<string, unknown>)[segment];
      }
      return true;
    } catch {
      return false;
    }
  }
  if (locator.kind === 'excerpt-hash') {
    return content
      .split(/\n\s*\n|\n/)
      .map((part) => part.trim())
      .filter(Boolean)
      .some((part) => sha256(part) === locator.excerptHash);
  }
  return source.mediaType.startsWith('audio/') || source.mediaType.startsWith('video/');
}

function lintPageFreshness(
  findings: KnowledgeIntegrityFinding[],
  page: KnowledgePage,
  rules: KnowledgeFreshnessRule[],
  asOfMs: number
): void {
  for (const rule of rules) {
    if (rule.target !== 'page-kind' || rule.match !== page.current.pageKind) continue;
    if (ageDays(page.current.updatedAt, asOfMs) > rule.maxAgeDays) {
      findings.push(
        finding('stale-page', 'warning', 'The page exceeds its configured freshness window.', {
          pageId: page.id,
          relatedIds: [`${rule.maxAgeDays}d`],
        })
      );
    }
  }
  const explicitReview = page.current.metadata.reviewDueAt;
  if (explicitReview && Date.parse(explicitReview) < asOfMs) {
    findings.push(
      finding('stale-page', 'warning', 'The page review date has passed.', {
        pageId: page.id,
        relatedIds: ['reviewDueAt'],
      })
    );
  }
}

function lintSourceFreshness(
  findings: KnowledgeIntegrityFinding[],
  source: KnowledgeSource,
  rules: KnowledgeFreshnessRule[],
  asOfMs: number
): void {
  for (const rule of rules) {
    if (rule.target !== 'source-media-type' || rule.match !== source.mediaType) continue;
    if (ageDays(source.capturedAt, asOfMs) > rule.maxAgeDays) {
      findings.push(
        finding('stale-source', 'warning', 'The source exceeds its configured freshness window.', {
          sourceId: source.id,
          relatedIds: [`${rule.maxAgeDays}d`],
        })
      );
    }
  }
}

function lintCanonicalTerms(
  findings: KnowledgeIntegrityFinding[],
  pages: KnowledgePage[],
  identityOwners: Map<string, string[]>
): void {
  const tagPages = new Map<string, Set<string>>();
  for (const page of pages) {
    for (const tag of page.current.tags) {
      const normalized = normalizeIdentity(tag);
      const pageIds = tagPages.get(normalized) ?? new Set<string>();
      pageIds.add(page.id);
      tagPages.set(normalized, pageIds);
    }
  }
  for (const [term, pageIds] of tagPages) {
    if (pageIds.size < 2 || identityOwners.has(term)) continue;
    findings.push(
      finding(
        'missing-canonical-page',
        'info',
        'A repeatedly referenced term has no canonical page.',
        { relatedIds: [term, ...pageIds] }
      )
    );
  }
}

function finding(
  kind: KnowledgeIntegrityFindingKind,
  severity: KnowledgeIntegritySeverity,
  message: string,
  identity: {
    pageId?: string;
    sourceId?: string;
    claimId?: string;
    relatedIds?: Iterable<string>;
  } = {}
): KnowledgeIntegrityFinding {
  const payload = {
    kind,
    severity,
    message,
    ...(identity.pageId ? { pageId: identity.pageId } : {}),
    ...(identity.sourceId ? { sourceId: identity.sourceId } : {}),
    ...(identity.claimId ? { claimId: identity.claimId } : {}),
    relatedIds: [...(identity.relatedIds ?? [])].sort(),
  };
  const digest = digestRunLaunchValue(payload);
  return {
    id: `knowledge_finding_${digest.slice('sha256:'.length, 40)}`,
    ...payload,
    digest,
  };
}

function compareFindings(
  left: KnowledgeIntegrityFinding,
  right: KnowledgeIntegrityFinding
): number {
  return (
    left.kind.localeCompare(right.kind) ||
    (left.pageId ?? '').localeCompare(right.pageId ?? '') ||
    (left.sourceId ?? '').localeCompare(right.sourceId ?? '') ||
    (left.claimId ?? '').localeCompare(right.claimId ?? '') ||
    left.id.localeCompare(right.id)
  );
}

function normalizeIdentity(value: string): string {
  return value.trim().toLocaleLowerCase('en-US');
}

function ageDays(value: string, asOfMs: number): number {
  return Math.max(0, (asOfMs - Date.parse(value)) / 86_400_000);
}

function sha256(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}
