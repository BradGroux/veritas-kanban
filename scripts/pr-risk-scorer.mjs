#!/usr/bin/env node
/**
 * PR Risk Scorer
 *
 * Computes a risk score for a pull request based on:
 * - Files changed count
 * - Lines added / deleted
 * - Sensitive path touches (auth, security, config, workflow, infra)
 * - Dependency file changes
 * - Test presence / absence
 *
 * Usage:
 *   node scripts/pr-risk-scorer.mjs [--json]
 *
 * Env vars (set by GitHub Actions):
 *   GITHUB_TOKEN, GITHUB_REPOSITORY, PR_NUMBER
 *
 * Configurable thresholds via env:
 *   RISK_THRESHOLD_MEDIUM (default 30)
 *   RISK_THRESHOLD_HIGH   (default 60)
 */

// ---------------------------------------------------------------------------
// Patterns
// ---------------------------------------------------------------------------

const SENSITIVE_PATTERNS = [
  /\bauth\b/i,
  /\bsecurity\b/i,
  /\bmiddleware\/.*validate/i,
  /\.github\/workflows\//,
  /Dockerfile/i,
  /docker-compose/i,
  /\.env/,
  /infrastructure\//i,
  /infra\//i,
  /terraform\//i,
  /k8s\//i,
  /helm\//i,
  /\.pre-commit/,
  /server\/src\/routes\/auth/,
  /server\/src\/middleware\//,
];

const DEPENDENCY_FILES = [
  'package.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'package-lock.json',
  'requirements.txt',
  'Pipfile.lock',
  'go.sum',
  'Cargo.lock',
];

const TEST_PATTERNS = [
  /\.test\.[jt]sx?$/,
  /\.spec\.[jt]sx?$/,
  /__tests__\//,
  /test\//,
  /tests\//,
];

// ---------------------------------------------------------------------------
// Scoring weights
// ---------------------------------------------------------------------------

const WEIGHTS = {
  filesChanged: 0.3,       // per file beyond 5
  linesChanged: 0.05,      // per 50 lines beyond 100
  sensitivePaths: 8,       // per sensitive file touched
  dependencyFiles: 5,      // per dependency file changed
  noTests: 15,             // penalty when PR has no test files
};

// ---------------------------------------------------------------------------
// Core scorer (exported for testing)
// ---------------------------------------------------------------------------

/**
 * Score a PR.
 * @param {{ files: string[], additions: number, deletions: number }} pr
 * @param {{ thresholdMedium?: number, thresholdHigh?: number }} [opts]
 * @returns {{ score: number, tier: string, reasons: string[], details: object }}
 */
export function scorePR(pr, opts = {}) {
  const thresholdMedium = opts.thresholdMedium ?? 30;
  const thresholdHigh = opts.thresholdHigh ?? 60;

  const files = pr.files ?? [];
  const additions = pr.additions ?? 0;
  const deletions = pr.deletions ?? 0;
  const totalLines = additions + deletions;

  let score = 0;
  const reasons = [];

  // 1. Files changed
  const fileCount = files.length;
  if (fileCount > 5) {
    const pts = Math.round((fileCount - 5) * WEIGHTS.filesChanged);
    score += pts;
    reasons.push(`${fileCount} files changed (+${pts} pts)`);
  }

  // 2. Lines changed
  if (totalLines > 100) {
    const pts = Math.round(((totalLines - 100) / 50) * WEIGHTS.linesChanged * 50);
    score += pts;
    reasons.push(`${totalLines} lines changed (+${additions}/-${deletions}) (+${pts} pts)`);
  }

  // 3. Sensitive paths
  const sensitivePaths = files.filter((f) =>
    SENSITIVE_PATTERNS.some((p) => p.test(f)),
  );
  if (sensitivePaths.length > 0) {
    const pts = sensitivePaths.length * WEIGHTS.sensitivePaths;
    score += pts;
    reasons.push(
      `${sensitivePaths.length} sensitive path(s) touched (+${pts} pts): ${sensitivePaths.join(', ')}`,
    );
  }

  // 4. Dependency files
  const depFiles = files.filter((f) =>
    DEPENDENCY_FILES.some((d) => f.endsWith(d)),
  );
  if (depFiles.length > 0) {
    const pts = depFiles.length * WEIGHTS.dependencyFiles;
    score += pts;
    reasons.push(
      `${depFiles.length} dependency file(s) changed (+${pts} pts): ${depFiles.join(', ')}`,
    );
  }

  // 5. Test presence
  const hasTests = files.some((f) => TEST_PATTERNS.some((p) => p.test(f)));
  if (!hasTests && fileCount > 0) {
    score += WEIGHTS.noTests;
    reasons.push(`No test files in PR (+${WEIGHTS.noTests} pts)`);
  }

  // Clamp
  score = Math.min(Math.round(score), 100);

  // Tier
  let tier = 'low';
  if (score >= thresholdHigh) tier = 'high';
  else if (score >= thresholdMedium) tier = 'medium';

  return {
    score,
    tier,
    reasons,
    details: {
      filesChanged: fileCount,
      linesChanged: totalLines,
      sensitivePaths,
      dependencyFiles: depFiles,
      hasTests,
    },
  };
}

// ---------------------------------------------------------------------------
// GitHub helpers
// ---------------------------------------------------------------------------

async function fetchPRData(token, repo, prNumber) {
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };

  const prRes = await fetch(
    `https://api.github.com/repos/${repo}/pulls/${prNumber}`,
    { headers },
  );
  if (!prRes.ok) throw new Error(`Failed to fetch PR: ${prRes.status}`);
  const prJson = await prRes.json();

  const files = [];
  let page = 1;
  while (page <= 3) {
    const fRes = await fetch(
      `https://api.github.com/repos/${repo}/pulls/${prNumber}/files?per_page=100&page=${page}`,
      { headers },
    );
    if (!fRes.ok) break;
    const batch = await fRes.json();
    if (batch.length === 0) break;
    files.push(...batch.map((f) => f.filename));
    page++;
  }

  return { files, additions: prJson.additions, deletions: prJson.deletions };
}

async function postComment(token, repo, prNumber, body) {
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json',
  };

  const MARKER = '<!-- pr-risk-scorer -->';
  const listRes = await fetch(
    `https://api.github.com/repos/${repo}/issues/${prNumber}/comments?per_page=100`,
    { headers },
  );
  let existingId = null;
  if (listRes.ok) {
    const comments = await listRes.json();
    const existing = comments.find((c) => c.body?.includes(MARKER));
    if (existing) existingId = existing.id;
  }

  const fullBody = `${MARKER}\n${body}`;

  if (existingId) {
    await fetch(
      `https://api.github.com/repos/${repo}/issues/comments/${existingId}`,
      { method: 'PATCH', headers, body: JSON.stringify({ body: fullBody }) },
    );
  } else {
    await fetch(
      `https://api.github.com/repos/${repo}/issues/${prNumber}/comments`,
      { method: 'POST', headers, body: JSON.stringify({ body: fullBody }) },
    );
  }
}

async function addLabels(token, repo, prNumber, tier) {
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json',
  };

  const labelsRes = await fetch(
    `https://api.github.com/repos/${repo}/issues/${prNumber}/labels`,
    { headers },
  );
  if (labelsRes.ok) {
    const labels = await labelsRes.json();
    for (const l of labels) {
      if (l.name.startsWith('risk:') && l.name !== `risk:${tier}`) {
        await fetch(
          `https://api.github.com/repos/${repo}/issues/${prNumber}/labels/${encodeURIComponent(l.name)}`,
          { method: 'DELETE', headers },
        );
      }
    }
  }

  await fetch(
    `https://api.github.com/repos/${repo}/issues/${prNumber}/labels`,
    { method: 'POST', headers, body: JSON.stringify({ labels: [`risk:${tier}`] }) },
  );
}

// ---------------------------------------------------------------------------
// CLI entry
// ---------------------------------------------------------------------------

async function main() {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPOSITORY;
  const prNumber = process.env.PR_NUMBER;
  const jsonMode = process.argv.includes('--json');
  const thresholdMedium = parseInt(process.env.RISK_THRESHOLD_MEDIUM || '30', 10);
  const thresholdHigh = parseInt(process.env.RISK_THRESHOLD_HIGH || '60', 10);
  const mergeGateEnabled = (process.env.MERGE_GATE_ENABLED ?? 'true') !== 'false';
  const requiredApprovals = parseInt(process.env.REQUIRED_APPROVALS || '2', 10);
  const securityReviewLabel = process.env.SECURITY_REVIEW_LABEL || 'security-reviewed';

  if (!token || !repo || !prNumber) {
    console.error('Missing GITHUB_TOKEN, GITHUB_REPOSITORY, or PR_NUMBER');
    process.exit(1);
  }

  const prData = await fetchPRData(token, repo, prNumber);
  const result = scorePR(prData, { thresholdMedium, thresholdHigh });

  if (jsonMode) {
    console.log(JSON.stringify(result, null, 2));
  }

  // Build comment
  const tierEmoji = { low: '🟢', medium: '🟡', high: '🔴' };
  const commentLines = [
    `## ${tierEmoji[result.tier]} PR Risk Score: ${result.score}/100 (${result.tier.toUpperCase()})`,
    '',
    '| Metric | Value |',
    '|--------|-------|',
    `| Files changed | ${result.details.filesChanged} |`,
    `| Lines changed | +${prData.additions}/-${prData.deletions} (${result.details.linesChanged} total) |`,
    `| Sensitive paths | ${result.details.sensitivePaths.length} |`,
    `| Dependency files | ${result.details.dependencyFiles.length} |`,
    `| Tests included | ${result.details.hasTests ? '✅' : '❌'} |`,
    '',
    '### Scoring Breakdown',
    '',
    ...result.reasons.map((r) => `- ${r}`),
  ];

  if (result.tier === 'high') {
    commentLines.push(
      '',
      '### ⚠️ Merge Gate: Additional Review Required',
      '',
      'This PR scored **high risk**. To merge, ensure:',
      `- [ ] At least **${requiredApprovals} approving reviews**`,
      `- [ ] Label \`${securityReviewLabel}\` is applied (security sign-off)`,
      '',
      'The merge gate check will pass once these conditions are met.',
    );
  }

  commentLines.push(
    '',
    `<sub>Scored by pr-risk-scorer • thresholds: medium≥${thresholdMedium}, high≥${thresholdHigh}</sub>`,
  );

  await postComment(token, repo, prNumber, commentLines.join('\n'));
  await addLabels(token, repo, prNumber, result.tier);

  // Merge gate for high-risk PRs
  if (result.tier === 'high' && mergeGateEnabled) {
    const headers = {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    };
    const reviewsRes = await fetch(
      `https://api.github.com/repos/${repo}/pulls/${prNumber}/reviews`,
      { headers },
    );
    const reviews = reviewsRes.ok ? await reviewsRes.json() : [];
    const approvals = new Set(
      reviews.filter((r) => r.state === 'APPROVED').map((r) => r.user?.login),
    );

    const labelsRes2 = await fetch(
      `https://api.github.com/repos/${repo}/issues/${prNumber}/labels`,
      { headers },
    );
    const labels = labelsRes2.ok ? await labelsRes2.json() : [];
    const hasSecurityLabel = labels.some((l) => l.name === securityReviewLabel);

    const gatePass = approvals.size >= requiredApprovals && hasSecurityLabel;

    if (!gatePass) {
      const missing = [];
      if (approvals.size < requiredApprovals) {
        missing.push(`${requiredApprovals - approvals.size} more approval(s) needed (have ${approvals.size}/${requiredApprovals})`);
      }
      if (!hasSecurityLabel) {
        missing.push(`Missing label: ${securityReviewLabel}`);
      }
      console.error(`\n❌ Merge gate FAILED for high-risk PR:\n${missing.map((m) => `  - ${m}`).join('\n')}`);
      process.exit(1);
    }
    console.log('✅ Merge gate passed for high-risk PR');
  } else {
    console.log(`✅ PR risk: ${result.tier} (score ${result.score}) — no merge gate block`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(err); process.exit(1); });
}
