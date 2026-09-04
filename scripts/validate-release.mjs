#!/usr/bin/env node
import { access, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyNativeEvidence } from './native-ui/verify.mjs';
import { packageDigest } from './native-ui/contract.mjs';
import { verifyMediaEvidence } from './docs-media/verify.mjs';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const packageFiles = [
  { label: 'root', file: 'package.json' },
  { label: 'shared', file: 'shared/package.json' },
  { label: 'server', file: 'server/package.json' },
  { label: 'web', file: 'web/package.json' },
  { label: 'cli', file: 'cli/package.json' },
  { label: 'mcp', file: 'mcp/package.json' },
  { label: 'desktop', file: 'desktop/package.json' },
];

const requiredFiles = [
  'CHANGELOG.md',
  'Dockerfile',
  'README.md',
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
];

const requiredScripts = [
  'audit',
  'build',
  'desktop:test:readiness',
  'desktop:wait:ready',
  'lint',
  'lint:budget',
  'qa:mantine',
  'smoke:cli-mcp',
  'test:e2e',
  'test:load',
  'test:load:smoke',
  'test:release-format',
  'test:release-native',
  'test:unit',
  'typecheck',
];

const buildOutputs = [
  { label: 'shared build output', file: 'shared/dist/index.js' },
  { label: 'server build output', file: 'server/dist/index.js' },
  { label: 'web build output', file: 'web/dist/index.html' },
  { label: 'CLI build output', file: 'cli/dist/index.js' },
  { label: 'MCP build output', file: 'mcp/dist/index.js' },
  { label: 'desktop build output', file: 'desktop/out/main/index.js' },
];

function releaseDocsForVersion(version) {
  const major = Number.parseInt(version.split('.')[0] ?? '', 10);

  if (major === 6) {
    return [
      {
        label: 'v6 compatibility and release policy',
        file: 'docs/V6-COMPATIBILITY-AND-RELEASE-POLICY.md',
        terms: [
          'Harness Support Tiers',
          'Compatibility Matrix',
          'Release Channels',
          'Rollback Policy',
        ],
      },
      {
        label: 'v6 upgrade install admin guide',
        file: 'docs/V6-UPGRADE-INSTALL-ADMIN-GUIDE.md',
        terms: [
          'Fresh Mac Desktop Install',
          'v5 To v6 Upgrade',
          'Harness Installation And Authentication',
          'Backup And Recovery',
        ],
      },
      {
        label: 'v6 release notes',
        file: 'docs/V6-RELEASE-NOTES.md',
        terms: [
          'Breaking Changes And Migration Warnings',
          'Known Limitations',
          'Release Artifacts',
        ],
      },
      {
        label: 'v6 GA checklist',
        file: 'docs/V6-GA-CHECKLIST.md',
        terms: [
          'Provider Certification',
          'Final Release Validation Commands',
          'Distribution And Post-Publication',
        ],
      },
      {
        label: 'v6 release candidate evidence packet',
        file: 'docs/V6-RC-EVIDENCE-PACKET.md',
        terms: [
          'Issue And Pull Request Traceability',
          'Verification Matrix',
          'Publication Evidence',
        ],
      },
      {
        label: 'v6 visual tour',
        file: 'docs/V6-VISUAL-TOUR.md',
        terms: ['Provider Support', 'Buzz Integration', 'Approval And Run Evidence'],
      },
      {
        label: 'v6 agent runtime architecture',
        file: 'docs/architecture/V6-AGENT-RUNTIME-CONTROL-PLANE.md',
        terms: ['Authority Model', 'Adapter Boundaries', 'Run Lifecycle', 'Security Boundaries'],
      },
    ];
  }

  if (major === 5) {
    return [
      {
        label: 'v5 compatibility and release policy',
        file: 'docs/V5-COMPATIBILITY-AND-RELEASE-POLICY.md',
        terms: ['Compatibility Matrix', 'Release Channels', 'Rollback Policy'],
      },
      {
        label: 'v5 upgrade install admin guide',
        file: 'docs/V5-UPGRADE-INSTALL-ADMIN-GUIDE.md',
        terms: ['Fresh Mac Desktop Install', 'v4 To v5 Upgrade', 'Multi-User Admin'],
      },
      {
        label: 'v5 release notes',
        file: 'docs/V5-RELEASE-NOTES.md',
        terms: ['Breaking Changes And Migration Warnings', 'Release Artifacts'],
      },
      {
        label: 'v5 GA checklist',
        file: 'docs/V5-GA-CHECKLIST.md',
        terms: ['Final Release Validation Commands', 'Post-GA backlog'],
      },
    ];
  }

  throw new Error(`Release document validation is not defined for major version ${major}.`);
}

const checks = [];

function usage() {
  console.log(`Usage: pnpm validate:release -- [options]

Options:
  --version <version>      Validate a specific version. Defaults to package.json version.
  --github                 Validate v<version> tag and GitHub release.
  --repo <owner/repo>      GitHub repository for --github. Defaults to package.json repository.
  --skip-build-output      Skip local dist artifact checks.
  --native-evidence <file> Candidate-bound packaged macOS evidence report.
  --native-app <path>      Exact .app verified by that report.
  --media-evidence <file>  Candidate-bound documentation capture manifest.
  --source-only           Source preflight only; never release acceptance.
  --docker-build           Build the production Docker image as part of validation.
  --help                   Show this help text.
`);
}

function parseArgs(argv) {
  const options = {
    dockerBuild: false,
    github: false,
    repo: undefined,
    skipBuildOutput: false,
    version: undefined,
    nativeEvidence: undefined,
    nativeApp: undefined,
    mediaEvidence: undefined,
    sourceOnly: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--') {
      continue;
    }

    if (arg === '--help' || arg === '-h') {
      usage();
      process.exit(0);
    }

    if (arg === '--github') {
      options.github = true;
      continue;
    }

    if (arg === '--skip-build-output') {
      options.skipBuildOutput = true;
      continue;
    }

    if (arg === '--source-only') {
      options.sourceOnly = true;
      continue;
    }
    if (arg === '--native-evidence' || arg === '--native-app' || arg === '--media-evidence') {
      const value = argv[++index];
      if (!value || value.startsWith('--')) {
        fail('CLI options', `${arg} requires a path`);
        continue;
      }
      const key = {
        '--native-evidence': 'nativeEvidence',
        '--native-app': 'nativeApp',
        '--media-evidence': 'mediaEvidence',
      }[arg];
      options[key] = value;
      continue;
    }

    if (arg === '--docker-build') {
      options.dockerBuild = true;
      continue;
    }

    if (arg === '--version') {
      options.version = argv[index + 1];
      index += 1;
      continue;
    }

    if (arg.startsWith('--version=')) {
      options.version = arg.slice('--version='.length);
      continue;
    }

    if (arg === '--repo') {
      options.repo = argv[index + 1];
      index += 1;
      continue;
    }

    if (arg.startsWith('--repo=')) {
      options.repo = arg.slice('--repo='.length);
      continue;
    }

    fail('CLI options', `Unknown option: ${arg}`);
  }

  return options;
}

function record(status, name, detail = '') {
  checks.push({ status, name, detail });
}

function pass(name, detail = '') {
  record('pass', name, detail);
}

function fail(name, detail = '') {
  record('fail', name, detail);
}

function skip(name, detail = '') {
  record('skip', name, detail);
}

function check(name, condition, detail = '') {
  if (condition) {
    pass(name, detail);
  } else {
    fail(name, detail);
  }
}

function relativePath(file) {
  return path.join(rootDir, file);
}

async function readText(file) {
  return readFile(relativePath(file), 'utf8');
}

async function readJson(file) {
  return JSON.parse(await readText(file));
}

async function exists(file) {
  try {
    await access(relativePath(file), constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: rootDir,
    encoding: 'utf8',
    stdio: options.stdio ?? 'pipe',
  });

  if (result.error) {
    return {
      ok: false,
      status: 1,
      stdout: '',
      stderr: result.error.message,
    };
  }

  return {
    ok: result.status === 0,
    status: result.status,
    stdout: typeof result.stdout === 'string' ? result.stdout.trim() : '',
    stderr: typeof result.stderr === 'string' ? result.stderr.trim() : '',
  };
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeReleaseBody(value) {
  return value.replace(/\r\n?/g, '\n').trim();
}

export function releaseBodyFormattingIssues(value, options = {}) {
  const { compactLayout = true } = options;
  const issues = [];
  const shortProseBlocks = [];

  if (value.includes('\r')) {
    issues.push('contains carriage-return characters');
  }

  const lines = value.replace(/\r\n?/g, '\n').split('\n');
  let inFence = false;
  let previousBlockLine;

  for (const [index, line] of lines.entries()) {
    const lineNumber = index + 1;
    const trimmed = line.trim();
    const trimmedStart = line.trimStart();

    if (/^```/.test(trimmedStart)) {
      inFence = !inFence;
      previousBlockLine = undefined;
      shortProseBlocks.length = 0;
      continue;
    }

    if (inFence) continue;

    if (trimmed.length === 0) {
      previousBlockLine = undefined;
      continue;
    }

    if (/\s{2}$/.test(line)) {
      issues.push(`line ${lineNumber} uses a Markdown hard break`);
    }

    if (/<br\s*\/?>/i.test(line)) {
      issues.push(`line ${lineNumber} contains an explicit HTML line break`);
    }

    if (/\\[rn](?:\\[rn])?/.test(line)) {
      issues.push(`line ${lineNumber} contains a literal escaped line break`);
    }

    if (/^\s*>/.test(line)) {
      issues.push(`line ${lineNumber} uses a blockquote instead of a full-width block`);
    }

    const blockLine = {
      lineNumber,
      heading: /^\s*#{1,6}\s+/.test(line),
      nestedHeading: /^\s*#{3,6}\s+/.test(line),
      listItem: /^\s*(?:[-*+]|\d+\.)\s+/.test(line),
      tableRow: /^\s*\|.*\|\s*$/.test(line),
    };

    if (compactLayout && blockLine.nestedHeading) {
      issues.push(
        `line ${lineNumber} uses a nested heading that fragments the GitHub release layout`
      );
    }

    if (compactLayout && !blockLine.listItem && /^\*\*[^*]+\*\*\s+\S/.test(trimmed)) {
      issues.push(
        `line ${lineNumber} uses a bold-led prose block; use a Markdown list for parallel release items`
      );
    }

    if (compactLayout && blockLine.listItem && trimmed.length > 160) {
      issues.push(
        `line ${lineNumber} uses a long list item that will render with ragged hanging indentation; shorten it or use a full-width prose paragraph`
      );
    }

    const proseBlock =
      !blockLine.heading && !blockLine.listItem && !blockLine.tableRow && trimmed.length < 160;

    if (compactLayout && proseBlock) {
      shortProseBlocks.push(lineNumber);
      if (shortProseBlocks.length === 3) {
        issues.push(
          `lines ${shortProseBlocks.join(
            ', '
          )} form consecutive short prose blocks; combine them into full-width paragraphs`
        );
      }
    } else {
      shortProseBlocks.length = 0;
    }

    if (
      previousBlockLine &&
      !(previousBlockLine.listItem && blockLine.listItem) &&
      !(previousBlockLine.tableRow && blockLine.tableRow)
    ) {
      issues.push(
        `lines ${previousBlockLine.lineNumber}-${lineNumber} are not separated by a blank line`
      );
    }

    previousBlockLine = blockLine;
  }

  if (inFence) {
    issues.push('contains an unclosed fenced code block');
  }

  return issues;
}

function parseGithubRepo(repositoryUrl) {
  if (!repositoryUrl) return undefined;

  const match = repositoryUrl.match(/github\.com[:/]([^/]+\/[^/.]+)(?:\.git)?$/);
  return match?.[1];
}

function printableDetail(detail) {
  return detail ? ` - ${detail}` : '';
}

export function remoteTagCommit(output, tagName) {
  const ref = `refs/tags/${tagName}`;
  const records = output
    .trim()
    .split('\n')
    .map((line) => line.trim().split(/\s+/));
  const direct = records.filter(([, name]) => name === ref);
  const peeled = records.filter(([, name]) => name === `${ref}^{}`);
  if (direct.length !== 1 || peeled.length > 1) return undefined;
  const commit = (peeled[0] ?? direct[0])[0];
  return /^[a-f0-9]{40}$/.test(commit) ? commit : undefined;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const packages = [];

  for (const packageFile of packageFiles) {
    packages.push({
      ...packageFile,
      json: await readJson(packageFile.file),
    });
  }

  const rootPackage = packages.find((pkg) => pkg.label === 'root').json;
  const expectedVersion = options.version ?? rootPackage.version;
  if (options.sourceOnly) {
    check(
      'Source-only preflight does not consume candidate evidence',
      !options.nativeEvidence && !options.nativeApp && !options.mediaEvidence,
      'Remove --source-only to validate a packaged candidate'
    );
    skip('Packaged macOS evidence', 'source-only preflight is not release acceptance');
  } else if (!options.nativeEvidence || !options.nativeApp) {
    fail(
      'Packaged macOS evidence',
      'Both --native-evidence and --native-app are required; --skip-build-output does not bypass this gate'
    );
  } else {
    const head = run('git', ['rev-parse', 'HEAD']);
    const tree = run('git', ['status', '--porcelain']);
    check(
      'Candidate checkout is clean',
      tree.ok && tree.stdout === '',
      'Native release evidence requires a clean candidate checkout'
    );
    try {
      if (!head.ok) throw new Error('Cannot resolve candidate commit');
      const errors = await verifyNativeEvidence({
        evidencePath: path.resolve(options.nativeEvidence),
        appPath: path.resolve(options.nativeApp),
        commit: head.stdout,
        version: expectedVersion,
      });
      check('Packaged macOS evidence', errors.length === 0, errors.join('; ') || head.stdout);
    } catch (error) {
      fail('Packaged macOS evidence', error.message);
    }
  }
  if (options.sourceOnly) {
    skip('Documentation media freshness', 'source-only preflight is not release acceptance');
  } else if (!options.mediaEvidence || !options.nativeApp) {
    fail(
      'Documentation media freshness',
      '--media-evidence and --native-app are required; a browser capture or source preflight cannot bypass this gate'
    );
  } else {
    try {
      const head = run('git', ['rev-parse', 'HEAD']);
      const tracked = run('git', ['ls-files', '-z', '--', 'README.md', 'docs']);
      if (!head.ok || !tracked.ok)
        throw new Error('Cannot resolve candidate commit or maintained documentation inventory');
      const maintainedContents = [];
      for (const file of tracked.stdout.split('\0').filter(Boolean)) {
        const bytes = await readFile(path.join(rootDir, file));
        if (!bytes.includes(0)) maintainedContents.push([file, bytes.toString('utf8')]);
      }
      const errors = await verifyMediaEvidence({
        evidencePath: path.resolve(options.mediaEvidence),
        root: rootDir,
        expected: {
          commit: head.stdout,
          version: expectedVersion,
          packageDigest: await packageDigest(path.resolve(options.nativeApp)),
        },
        maintainedContents,
      });
      check('Documentation media freshness', errors.length === 0, errors.join('; ') || head.stdout);
    } catch (error) {
      fail('Documentation media freshness', error.message);
    }
  }
  const requiredReleaseDocs = releaseDocsForVersion(expectedVersion);
  const releaseBodyFile = `docs/releases/v${expectedVersion}.md`;
  const releaseBodyExists = await exists(releaseBodyFile);
  const releaseBody = releaseBodyExists ? await readText(releaseBodyFile) : '';
  const releaseVersionParts = expectedVersion
    .split(/[+-]/, 1)[0]
    .split('.')
    .map((part) => Number.parseInt(part, 10));
  const compactReleaseLayout =
    releaseVersionParts[0] > 6 ||
    (releaseVersionParts[0] === 6 &&
      (releaseVersionParts[1] > 0 ||
        (releaseVersionParts[1] === 0 && releaseVersionParts[2] >= 2)));
  const releaseBodyIssues = releaseBodyExists
    ? releaseBodyFormattingIssues(releaseBody, { compactLayout: compactReleaseLayout })
    : [];

  check(
    'Release version is valid semver',
    /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(expectedVersion),
    expectedVersion
  );

  for (const packageFile of requiredFiles) {
    check(`Required file exists: ${packageFile}`, await exists(packageFile));
  }

  check('Reviewed GitHub release body exists', releaseBodyExists, releaseBodyFile);
  check(
    'GitHub release body uses full-width Markdown blocks',
    releaseBodyExists && releaseBodyIssues.length === 0,
    releaseBodyIssues.slice(0, 3).join('; ') || releaseBodyFile
  );

  for (const pkg of packages) {
    check(
      `${pkg.label} package version matches ${expectedVersion}`,
      pkg.json.version === expectedVersion,
      `found ${pkg.json.version}`
    );
  }

  const desktopPackage = packages.find((pkg) => pkg.label === 'desktop')?.json;
  if (desktopPackage) {
    for (const scriptName of ['package:mac:unsigned', 'release:mac']) {
      check(
        `Desktop release script exists: ${scriptName}`,
        typeof desktopPackage.scripts?.[scriptName] === 'string',
        desktopPackage.scripts?.[scriptName] ?? 'missing'
      );
    }
  }

  check(
    'packageManager pins pnpm',
    /^pnpm@\d+\.\d+\.\d+$/.test(rootPackage.packageManager ?? ''),
    rootPackage.packageManager ?? 'not declared'
  );

  check(
    'Node engine targets Node 22 or newer',
    /^>=22\b/.test(rootPackage.engines?.node ?? ''),
    rootPackage.engines?.node ?? 'not declared'
  );

  for (const scriptName of requiredScripts) {
    check(
      `Required package script exists: ${scriptName}`,
      typeof rootPackage.scripts?.[scriptName] === 'string',
      rootPackage.scripts?.[scriptName] ?? 'missing'
    );
  }

  const readme = await readText('README.md');
  check(
    'README version badge matches release version',
    new RegExp(`version-${escapeRegex(expectedVersion)}-blue\\.svg`).test(readme),
    `expected badge version ${expectedVersion}`
  );

  const changelog = await readText('CHANGELOG.md');
  check(
    'CHANGELOG has a release heading',
    new RegExp(
      `^## \\[${escapeRegex(expectedVersion)}\\](?:\\s+-\\s+\\d{4}-\\d{2}-\\d{2})?$`,
      'm'
    ).test(changelog),
    `expected ## [${expectedVersion}]`
  );

  for (const doc of requiredReleaseDocs) {
    const docExists = await exists(doc.file);
    check(`Required release doc exists: ${doc.label}`, docExists, doc.file);
    if (!docExists) continue;

    const content = await readText(doc.file);
    for (const term of doc.terms) {
      check(
        `Required release doc section exists: ${doc.label} -> ${term}`,
        content.includes(term),
        doc.file
      );
    }
  }

  if (options.skipBuildOutput) {
    skip('Local build output validation', 'skipped by --skip-build-output');
  } else {
    for (const artifact of buildOutputs) {
      check(`${artifact.label} exists`, await exists(artifact.file), artifact.file);
    }
  }

  if (options.github) {
    const tagName = `v${expectedVersion}`;
    const repo = options.repo ?? parseGithubRepo(rootPackage.repository?.url);

    check(
      'GitHub repository resolved',
      typeof repo === 'string' && repo.length > 0,
      repo ?? 'missing'
    );

    const localTag = run('git', ['tag', '--list', tagName]);
    check(
      `Local git tag exists: ${tagName}`,
      localTag.ok && localTag.stdout.split('\n').includes(tagName),
      localTag.ok && localTag.stdout ? tagName : localTag.stderr || 'not found'
    );

    const remoteTag = run('git', [
      'ls-remote',
      '--tags',
      'origin',
      `refs/tags/${tagName}`,
      `refs/tags/${tagName}^{}`,
    ]);
    check(
      `Origin git tag exists: ${tagName}`,
      remoteTag.ok && remoteTag.stdout.includes(`refs/tags/${tagName}`),
      remoteTag.ok && remoteTag.stdout ? 'origin' : remoteTag.stderr || 'not found'
    );
    const candidateHead = run('git', ['rev-parse', 'HEAD']);
    check(
      `Origin release tag matches candidate: ${tagName}`,
      candidateHead.ok &&
        remoteTag.ok &&
        remoteTagCommit(remoteTag.stdout, tagName) === candidateHead.stdout,
      'The destination tag must resolve to the verified checkout commit'
    );

    if (repo) {
      const release = run('gh', [
        'release',
        'view',
        tagName,
        '--repo',
        repo,
        '--json',
        'body,isDraft,isPrerelease,name,tagName,url',
      ]);

      if (release.ok) {
        const releaseJson = JSON.parse(release.stdout);
        check(
          `GitHub release exists: ${tagName}`,
          releaseJson.tagName === tagName,
          releaseJson.url ?? releaseJson.name ?? ''
        );
        check(
          `GitHub release is published: ${tagName}`,
          releaseJson.isDraft === false,
          releaseJson.isDraft ? 'draft release' : 'published'
        );
        check(
          `GitHub release body matches ${releaseBodyFile}`,
          releaseBodyExists &&
            normalizeReleaseBody(releaseJson.body ?? '') === normalizeReleaseBody(releaseBody),
          releaseBodyFile
        );
      } else {
        fail(`GitHub release exists: ${tagName}`, release.stderr || 'gh release view failed');
      }
    }
  } else {
    skip('Git tag and GitHub release validation', 'pass --github to verify remote release state');
  }

  if (options.dockerBuild) {
    const dockerTag = `veritas-kanban:validate-${expectedVersion.replace(/[^0-9A-Za-z_.-]/g, '-')}`;
    const result = run('docker', ['build', '--target', 'production', '-t', dockerTag, '.'], {
      stdio: 'inherit',
    });
    check('Production Docker image builds', result.ok, dockerTag);
  } else {
    skip('Production Docker image build', 'pass --docker-build to verify the image');
  }

  const labels = {
    fail: 'FAIL',
    pass: 'PASS',
    skip: 'SKIP',
  };

  console.log(
    `\n${options.sourceOnly ? 'Source preflight' : 'Release validation'} for ${expectedVersion}\n`
  );

  for (const item of checks) {
    console.log(`${labels[item.status]} ${item.name}${printableDetail(item.detail)}`);
  }

  const failures = checks.filter((item) => item.status === 'fail');
  if (failures.length > 0) {
    console.error(`\nRelease validation failed: ${failures.length} check(s) failed.`);
    process.exit(1);
  }

  console.log(
    options.sourceOnly
      ? '\nSource preflight passed. Packaged, installed, signing, documentation-media, and publication acceptance are not established.'
      : '\nRelease validation passed. Installed-app, signing, media visual/playback review, and publication acceptance require their separate evidence.'
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
