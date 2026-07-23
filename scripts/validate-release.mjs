#!/usr/bin/env node
import { access, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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

const requiredReleaseDocs = [
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

const checks = [];

function usage() {
  console.log(`Usage: pnpm validate:release -- [options]

Options:
  --version <version>      Validate a specific version. Defaults to package.json version.
  --github                 Validate v<version> tag and GitHub release.
  --repo <owner/repo>      GitHub repository for --github. Defaults to package.json repository.
  --skip-build-output      Skip local dist artifact checks.
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

function parseGithubRepo(repositoryUrl) {
  if (!repositoryUrl) return undefined;

  const match = repositoryUrl.match(/github\.com[:/]([^/]+\/[^/.]+)(?:\.git)?$/);
  return match?.[1];
}

function printableDetail(detail) {
  return detail ? ` - ${detail}` : '';
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

  check(
    'Release version is valid semver',
    /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(expectedVersion),
    expectedVersion
  );

  for (const packageFile of requiredFiles) {
    check(`Required file exists: ${packageFile}`, await exists(packageFile));
  }

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

    const remoteTag = run('git', ['ls-remote', '--tags', 'origin', `refs/tags/${tagName}`]);
    check(
      `Origin git tag exists: ${tagName}`,
      remoteTag.ok && remoteTag.stdout.includes(`refs/tags/${tagName}`),
      remoteTag.ok && remoteTag.stdout ? 'origin' : remoteTag.stderr || 'not found'
    );

    if (repo) {
      const release = run('gh', [
        'release',
        'view',
        tagName,
        '--repo',
        repo,
        '--json',
        'isDraft,isPrerelease,name,tagName,url',
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

  console.log(`\nRelease validation for ${expectedVersion}\n`);

  for (const item of checks) {
    console.log(`${labels[item.status]} ${item.name}${printableDetail(item.detail)}`);
  }

  const failures = checks.filter((item) => item.status === 'fail');
  if (failures.length > 0) {
    console.error(`\nRelease validation failed: ${failures.length} check(s) failed.`);
    process.exit(1);
  }

  console.log('\nRelease validation passed.');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
