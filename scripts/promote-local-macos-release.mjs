#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { openSync, closeSync } from 'node:fs';
import { copyFile, lstat, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { releaseEnvironment } from './capture-local-macos-release.mjs';
import { distributionNames, verifyLocalCandidate } from './local-macos-candidate.mjs';
import { fileDigest, packageDigest } from './native-ui/contract.mjs';
import { verifyPublicationHistory } from './docs-media/publication.mjs';
import { remoteTagCommit } from './validate-release.mjs';

const root = path.resolve(import.meta.dirname, '..');
const repository = 'BradGroux/veritas-kanban';
const hostRepository = `github.com/${repository}`;

export function assertReleaseDestination(release, { tag, notes, prerelease }) {
  assert.equal(release.tag_name, tag, 'Release tag differs');
  assert.equal(release.author?.login, 'BradGroux', 'Release author differs');
  assert.equal(release.body, notes, 'Existing release notes differ; preserve the destination');
  assert.equal(release.draft, true, 'Existing release is already public; inspect it explicitly');
  assert.equal(release.prerelease, prerelease, 'Existing release channel differs');
  assert.equal(
    release.performed_via_github_app ?? null,
    null,
    'Release was published through an application'
  );
}

export function planReleaseAssets(assets, expected) {
  const seen = new Set();
  for (const asset of assets) {
    assert(!seen.has(asset.name), 'Duplicate destination release asset');
    seen.add(asset.name);
    const file = expected.find((entry) => entry.name === asset.name);
    assert(file, 'Unexpected destination release asset; preserve it for review');
    assert.equal(asset.state, 'uploaded', 'Destination asset is incomplete');
    assert.equal(asset.size, file.size, 'Destination asset size differs');
    if (asset.digest)
      assert.equal(asset.digest, `sha256:${file.sha256}`, 'Destination asset digest differs');
  }
  return expected.filter((file) => !seen.has(file.name));
}

export function assertTagDestination(listing, tag, commit, { requireAnnotated = false } = {}) {
  if (!listing.trim()) return false;
  assert.equal(
    remoteTagCommit(listing, tag),
    commit,
    'Existing remote tag differs; never rewrite it'
  );
  if (requireAnnotated)
    assert(
      listing.split('\n').some((line) => line.trim().split(/\s+/)[1] === `refs/tags/${tag}^{}`),
      'Stable release requires an annotated remote tag; never rewrite an existing tag'
    );
  return true;
}

export function ensureLocalPublicationTag(git, tag, commit, { requireAnnotated = false } = {}) {
  const ref = `refs/tags/${tag}`;
  if (!git('tag', '--list', tag)) {
    assert(
      git('var', 'GIT_COMMITTER_IDENT').includes('<3053586+BradGroux@users.noreply.github.com>'),
      'Tagger must use the approved private email identity'
    );
    git('tag', '--annotate', tag, commit, '--message', tag);
  }
  assert.equal(git('rev-parse', `${ref}^{commit}`), commit, 'Existing local tag differs');
  if (requireAnnotated)
    assert.equal(
      git('cat-file', '-t', ref),
      'tag',
      'Stable release requires an annotated local tag'
    );
  return ref;
}

function run(command, args, env, { inherit = false, stdout } = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    env,
    shell: false,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    ...(inherit
      ? { stdio: 'inherit' }
      : stdout !== undefined
        ? { stdio: ['ignore', stdout, 'pipe'] }
        : {}),
  });
  assert.ifError(result.error);
  assert.equal(
    result.status,
    0,
    `${path.basename(command)} failed (exit ${result.status ?? result.signal})`
  );
  return result.stdout?.trim() ?? '';
}

export async function promoteLocalRelease({ mode, candidate, digest, output, prerelease, latest }) {
  assert(['verify', 'publish'].includes(mode), 'Choose verify or publish');
  assert(
    process.platform === 'darwin' && process.arch === 'arm64',
    'Promotion requires macOS Apple Silicon'
  );
  if (mode === 'publish')
    assert(
      typeof prerelease === 'boolean' && typeof latest === 'boolean',
      'Publishing requires explicit prerelease and latest choices'
    );
  const directory = await realpath(candidate);
  const manifest = await verifyLocalCandidate({
    directory,
    expectedDigest: digest,
    allowPublication: true,
  });
  const env = {
    ...releaseEnvironment(process.env, manifest.commit, manifest.channel),
    GH_PROMPT_DISABLED: 'true',
  };
  const git = (...args) => run('git', args, env);
  const publicationCommit = git('rev-parse', 'HEAD');
  verifyPublicationHistory({
    root,
    buildCommit: manifest.commit,
    publicationCommit,
    version: manifest.version,
  });
  assert.equal(
    git('rev-parse', `${manifest.commit}^{tree}`),
    manifest.tree,
    'Retained source tree differs'
  );
  assert(
    [
      'https://github.com/BradGroux/veritas-kanban.git',
      'git@github.com:BradGroux/veritas-kanban.git',
    ].includes(git('remote', 'get-url', 'origin')),
    'Unexpected publication remote'
  );
  const parent = await realpath(path.dirname(path.resolve(output)));
  const destination = path.join(parent, path.basename(path.resolve(output)));
  for (const protectedRoot of [await realpath(root), directory])
    assert(
      destination !== protectedRoot && !destination.startsWith(protectedRoot + path.sep),
      'Promotion output must be external to the checkout and candidate'
    );
  await mkdir(destination, { mode: 0o700 }); // Refuse to overwrite a previous attempt.
  const receipt = {
    schema: 'local-macos-release-promotion/v1',
    status: 'running',
    candidateDigest: digest,
    buildCommit: manifest.commit,
    publicationCommit,
    version: manifest.version,
    channel: manifest.channel,
    phases: [],
  };
  const receiptPath = path.join(destination, 'promotion.json');
  const persist = () =>
    writeFile(receiptPath, JSON.stringify(receipt, null, 2) + '\n', { mode: 0o600 });
  const phase = async (name, operation) => {
    receipt.currentPhase = name;
    await persist();
    const value = await operation();
    receipt.phases.push(name);
    await persist();
    return value;
  };
  const command = (name, commandName, args) =>
    phase(name, () => run(commandName, args, env, { inherit: true }));
  const gh = (...args) => run('gh', args, env);
  const api = (...args) => gh('api', '--hostname', 'github.com', ...args);
  const githubGuard = () => {
    assert.equal(api('user', '--jq', '.login'), 'BradGroux', 'Wrong authenticated GitHub account');
    assert.equal(
      JSON.parse(api(`repos/${repository}/actions/permissions`)).enabled,
      false,
      'GitHub Actions must remain disabled'
    );
  };
  const tag = `v${manifest.version}`;
  const tagPolicy = { requireAnnotated: manifest.channel === 'stable' };
  const notesFile = path.join(root, `docs/releases/${tag}.md`);
  const publication = path.join(directory, 'documentation-media/publication.json');
  const app = path.join(destination, 'extracted/veritas-kanban.app');
  const validationArgs = [
    'scripts/validate-release.mjs',
    '--version',
    manifest.version,
    '--skip-build-output',
    '--native-evidence',
    path.join(directory, 'native-ui-evidence/evidence.json'),
    '--native-app',
    app,
    '--media-evidence',
    publication,
  ];
  const readRelease = () => {
    const matches = JSON.parse(
      api(`repos/${repository}/releases?per_page=100`, '--paginate', '--slurp')
    )
      .flat()
      .filter((release) => release.tag_name === tag);
    assert(matches.length <= 1, 'Multiple destination releases');
    return matches[0];
  };
  const tagListing = () =>
    git('ls-remote', '--tags', 'origin', `refs/tags/${tag}`, `refs/tags/${tag}^{}`);
  try {
    await phase('retained-source', async () => {
      await verifyLocalCandidate({ directory, expectedDigest: digest, allowPublication: true });
      assert(
        (await lstat(notesFile)).isFile() && !(await lstat(notesFile)).isSymbolicLink(),
        'Release notes must be a regular source file'
      );
    });
    await mkdir(path.dirname(app));
    await command('extract-original-distribution', 'ditto', [
      '-x',
      '-k',
      path.join(directory, 'release', `Veritas-Kanban-${manifest.version}-mac-arm64.zip`),
      path.dirname(app),
    ]);
    assert.equal(
      await packageDigest(app),
      manifest.packageDigest,
      'Extracted app differs from the original capture'
    );
    await command('app-signature', 'codesign', ['--verify', '--deep', '--strict', app]);
    await command('app-gatekeeper', 'spctl', ['--assess', '--type', 'execute', app]);
    const dmg = path.join(directory, 'release', `Veritas-Kanban-${manifest.version}-mac-arm64.dmg`);
    await command('dmg-signature', 'codesign', ['--verify', '--verbose=2', dmg]);
    await command('dmg-gatekeeper', 'spctl', [
      '-a',
      '-vvv',
      '-t',
      'open',
      '--context',
      'context:primary-signature',
      dmg,
    ]);
    try {
      await lstat(publication);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      await command('bind-original-media', process.execPath, [
        'scripts/docs-media/publish.mjs',
        path.join(directory, 'documentation-media/evidence.json'),
        app,
        publication,
      ]);
    }
    await command('full-local-validation', process.execPath, validationArgs);
    const notes = await readFile(notesFile, 'utf8');
    const assets = [];
    const assetDirectory = path.join(destination, 'assets');
    await mkdir(assetDirectory);
    for (const name of distributionNames(manifest.version)) {
      const file = path.join(assetDirectory, name);
      await copyFile(path.join(directory, 'release', name), file);
      assets.push({ name, file, sha256: await fileDigest(file), size: (await lstat(file)).size });
      if (name.endsWith('.dmg') || name.endsWith('.zip')) {
        const sidecarName = `${name}.sha256`;
        const sidecar = path.join(assetDirectory, sidecarName);
        await writeFile(sidecar, `${assets.at(-1).sha256}  ${name}\n`, { flag: 'wx' });
        assets.push({
          name: sidecarName,
          file: sidecar,
          sha256: await fileDigest(sidecar),
          size: (await lstat(sidecar)).size,
        });
      }
    }
    receipt.assets = assets.map(({ name, size, sha256 }) => ({ name, size, sha256 }));
    if (mode === 'verify') {
      receipt.status = 'locally-verified';
      await persist();
      return receipt;
    }
    await phase('github-account-and-automation', () => {
      gh('auth', 'status', '--hostname', 'github.com');
      githubGuard();
    });
    let release = readRelease();
    if (release) assertReleaseDestination(release, { tag, notes, prerelease });
    const hasTag = assertTagDestination(tagListing(), tag, publicationCommit, tagPolicy);
    const localTag = git('tag', '--list', tag);
    if (localTag) ensureLocalPublicationTag(git, tag, publicationCommit, tagPolicy);
    await phase('publication-tag', () => {
      githubGuard();
      if (!hasTag) {
        const ref = ensureLocalPublicationTag(git, tag, publicationCommit, tagPolicy);
        git('push', 'origin', `${ref}:${ref}`);
      }
      assert(
        assertTagDestination(tagListing(), tag, publicationCommit, tagPolicy),
        'Publication tag is missing'
      );
      if (!localTag) git('fetch', 'origin', 'tag', tag);
    });
    if (!release)
      await phase('draft-release', () => {
        githubGuard();
        gh(
          'release',
          'create',
          tag,
          '--repo',
          hostRepository,
          '--verify-tag',
          '--draft',
          '--title',
          tag,
          '--notes-file',
          notesFile,
          `--prerelease=${prerelease}`,
          '--latest=false'
        );
      });
    release = readRelease();
    assertReleaseDestination(release, { tag, notes, prerelease });
    receipt.releaseId = release.id;
    const missing = planReleaseAssets(release.assets, assets);
    await phase('draft-assets', () => {
      githubGuard();
      if (missing.length)
        gh('release', 'upload', tag, '--repo', hostRepository, ...missing.map((file) => file.file));
    });
    release = readRelease();
    assertReleaseDestination(release, { tag, notes, prerelease });
    assert.equal(planReleaseAssets(release.assets, assets).length, 0, 'Missing uploaded assets');
    await phase('uploaded-byte-readback', async () => {
      const download = path.join(destination, 'download');
      await mkdir(download);
      for (const asset of release.assets) {
        const file = path.join(download, asset.name);
        const descriptor = openSync(file, 'wx', 0o600);
        try {
          run(
            'gh',
            [
              'api',
              '--hostname',
              'github.com',
              `repos/${repository}/releases/assets/${asset.id}`,
              '-H',
              'Accept: application/octet-stream',
            ],
            env,
            { stdout: descriptor }
          );
        } finally {
          closeSync(descriptor);
        }
        assert.equal(
          await fileDigest(file),
          assets.find((expected) => expected.name === asset.name).sha256,
          'Uploaded bytes differ; preserve the draft'
        );
      }
    });
    await phase('final-source-and-candidate', async () => {
      await verifyLocalCandidate({ directory, expectedDigest: digest, allowPublication: true });
      assert.equal(
        await readFile(notesFile, 'utf8'),
        notes,
        'Release notes changed during staging'
      );
      assert(
        assertTagDestination(tagListing(), tag, publicationCommit, tagPolicy),
        'Publication tag is missing'
      );
      verifyPublicationHistory({
        root,
        buildCommit: manifest.commit,
        publicationCommit,
        version: manifest.version,
      });
      assert.equal(
        await packageDigest(app),
        manifest.packageDigest,
        'Verified app changed during staging'
      );
      const current = readRelease();
      assertReleaseDestination(current, { tag, notes, prerelease });
      const identities = (assets) =>
        assets
          .map(({ id, name, size, digest }) => ({ id, name, size, digest }))
          .sort((a, b) => a.name.localeCompare(b.name));
      assert.deepEqual(
        identities(current.assets),
        identities(release.assets),
        'Destination assets changed after byte readback'
      );
    });
    await phase('publish', () => {
      githubGuard();
      gh(
        'release',
        'edit',
        tag,
        '--repo',
        hostRepository,
        '--draft=false',
        '--notes-file',
        notesFile,
        `--latest=${latest}`
      );
    });
    const published = readRelease();
    assert.equal(published.draft, false);
    assert.equal(published.body, notes);
    assert.equal(published.author?.login, 'BradGroux');
    await command('published-validation', process.execPath, [
      ...validationArgs,
      '--github',
      '--repo',
      repository,
    ]);
    receipt.status = 'published-awaiting-rendered-review';
    receipt.url = published.html_url;
    await persist();
    console.log(
      `Inspect the rendered releases index and tag page: https://github.com/${repository}/releases and ${published.html_url}`
    );
    console.log(
      'Installed-app acceptance, workspace integration and actual media visual/playback review retain their separate evidence requirements.'
    );
    return receipt;
  } catch (error) {
    receipt.status = 'failed';
    await persist();
    throw error; // Preserve all extracted bytes, draft assets and receipt for explicit recovery.
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [mode, ...args] = process.argv.slice(2);
    const options = { mode };
    for (let index = 0; index < args.length; index += 2) {
      const key = args[index]?.slice(2);
      const value = args[index + 1];
      assert(
        ['candidate', 'digest', 'output', 'prerelease', 'latest'].includes(key) &&
          args[index].startsWith('--') &&
          value &&
          !value.startsWith('--') &&
          !(key in options),
        'Invalid or duplicate promotion argument'
      );
      if (['prerelease', 'latest'].includes(key)) {
        assert(['true', 'false'].includes(value));
        options[key] = value === 'true';
      } else options[key] = value;
    }
    assert(
      options.candidate && options.digest && options.output,
      'Usage: promote-local-macos-release.mjs verify|publish --candidate <retained-directory> --digest <reviewed-sha256> --output <new-external-directory> [--prerelease true|false --latest true|false]'
    );
    const result = await promoteLocalRelease(options);
    console.log(`Promotion status: ${result.status}`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
