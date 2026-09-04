import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileDigest } from '../native-ui/contract.mjs';

export const mediaSchema = 'documentation-media-capture/v1';
export const maintainedAssets = [
  'agent-providers.png',
  'board-overview.png',
  'board-to-workspace.gif',
  'command-palette.png',
  'maintenance-center.png',
  'mobile-board.png',
  'mobile-flow.gif',
  'mobile-settings.png',
  'mobile-task-workspace.png',
  'notification-adapters.png',
  'settings-navigation.png',
  'squad-chat.png',
  'task-workspace.png',
  'workbench-panel.png',
];

const digest = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const text = (value) => typeof value === 'string' && value.trim().length > 0;

// Decode the ASCII URL characters that HTML/JSON metadata can spell without
// changing the destination. Non-ASCII entities cannot spell maintained names.
function decodeDestinations(content) {
  const entities = {
    amp: '&',
    quot: '"',
    apos: "'",
    sol: '/',
    bsol: '\\',
    period: '.',
    percnt: '%',
    colon: ':',
    quest: '?',
    num: '#',
    equals: '=',
  };
  return content
    .replace(/\\u([a-f0-9]{4})/gi, (_, hex) => String.fromCharCode(Number.parseInt(hex, 16)))
    .replaceAll('\\/', '/')
    .replace(/&(#x[a-f0-9]+|#\d+|[a-z]+);/gi, (original, entity) => {
      if (!entity.startsWith('#')) return entities[entity] ?? original;
      const hex = entity[1].toLowerCase() === 'x';
      const code = Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : original;
    });
}

// This is provenance/freshness validation, not a claim that the pixels or GIF
// semantics have been reviewed. The capture and playback checks remain separate.
export function mediaEvidenceFailures(report, expected, now = Date.now()) {
  if (
    !/^[a-f0-9]{40}$/.test(expected?.commit ?? '') ||
    !digest(expected?.packageDigest) ||
    !/^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/i.test(expected?.version ?? '')
  )
    return ['invalid expected documentation candidate identity'];
  if (report?.schema !== mediaSchema) return ['missing or unknown documentation media schema'];
  const errors = [];
  if (report.status !== 'captured') errors.push('documentation capture did not finish');
  if (report.commit !== expected.commit) errors.push('stale documentation candidate commit');
  if (report.version !== expected.version) errors.push('stale documentation version');
  if (report.packageDigest !== expected.packageDigest)
    errors.push('stale documentation candidate package');
  const completed = Date.parse(report.completedAt);
  if (!Number.isFinite(completed) || completed > now)
    errors.push('missing or future documentation completion time');
  const assets = Array.isArray(report.assets) ? report.assets : [];
  if (
    assets.length !== maintainedAssets.length ||
    new Set(assets.map((asset) => asset?.name)).size !== maintainedAssets.length
  )
    errors.push('missing or duplicate maintained media decisions');
  for (const name of maintainedAssets) {
    const asset = assets.find((item) => item?.name === name);
    if (!asset || !['keep', 'replace', 'retire'].includes(asset.decision) || !text(asset.reason)) {
      errors.push(`${name}: missing explicit media decision and reason`);
      continue;
    }
    if (asset.decision === 'retire') {
      if (name.endsWith('.gif'))
        errors.push(`${name}: named interaction GIF must remain maintained`);
      if (asset.path !== undefined || asset.sha256 !== undefined || asset.capture !== undefined)
        errors.push(`${name}: retired media must not claim a current capture`);
      continue;
    }
    if (asset.path !== `docs/assets/v${expected.version}/${name}`)
      errors.push(`${name}: capture is outside the candidate versioned media directory`);
    if (!digest(asset.sha256)) errors.push(`${name}: missing asset digest`);
    const capture = asset.capture;
    if (capture?.commit !== expected.commit || capture?.version !== expected.version)
      errors.push(`${name}: stale capture identity`);
    if (capture?.packageDigest !== expected.packageDigest)
      errors.push(`${name}: capture is not bound to the candidate package`);
    const boundary = name.startsWith('mobile-') ? 'mobile-browser' : 'packaged-macos';
    if (capture?.boundary !== boundary) errors.push(`${name}: wrong capture boundary`);
    if (boundary === 'packaged-macos' && capture?.packaged !== true)
      errors.push(`${name}: desktop capture did not use the packaged application`);
    if (boundary === 'mobile-browser' && (capture?.width !== 390 || capture?.height !== 844))
      errors.push(`${name}: wrong supported mobile viewport`);
    if (
      ![capture?.width, capture?.height, capture?.scaleFactor].every(
        (n) => Number.isFinite(n) && n > 0
      )
    )
      errors.push(`${name}: missing capture dimensions or scale`);
    const capturedAt = Date.parse(capture?.capturedAt);
    if (!Number.isFinite(capturedAt) || capturedAt > completed || capturedAt > now)
      errors.push(`${name}: invalid capture time`);
    if (name.endsWith('.gif') && capture?.method !== 'interaction-recording')
      errors.push(`${name}: still-image montage is not an interaction recording`);
    if (name.endsWith('.png') && capture?.method !== 'window-capture')
      errors.push(`${name}: missing window capture provenance`);
  }
  return errors;
}

// Inspect tracked maintained text, including the docs index/metadata. Historical
// release sources keep their historical links; ordinary guides may not do so.
export function staleMediaReferences(contents, report, version) {
  const errors = [];
  const retired = new Set(
    (report.assets ?? []).filter((a) => a?.decision === 'retire').map((a) => a.name)
  );
  for (const [file, content] of contents) {
    if (file.startsWith('docs/releases/')) continue;
    if (file !== 'README.md' && !file.startsWith('docs/')) continue;
    // Tokenize destinations in Markdown, HTML, CSS, and JSON metadata. URL
    // resolution must precede version checks: dot segments and encoded names
    // are legitimate links, not permission to bypass the stale-reference gate.
    for (const token of decodeDestinations(content).matchAll(/[^\s"'<>()[\]{}=]+/g)) {
      let pathname;
      try {
        const url = new URL(token[0], `https://documentation.invalid/${file}`);
        pathname = path.posix.normalize(decodeURIComponent(url.pathname));
      } catch {
        continue; // Malformed URLs belong to the documentation link checker.
      }
      const name = path.posix.basename(pathname);
      if (!maintainedAssets.includes(name)) continue;
      if (!pathname.endsWith(`/assets/v${version}/${name}`))
        errors.push(`${file}: stale maintained reference ${token[0]}`);
      if (retired.has(name)) errors.push(`${file}: retired media remains referenced: ${name}`);
    }
  }
  return errors;
}

export async function verifyMediaEvidence({ evidencePath, root, expected, maintainedContents }) {
  if (!Array.isArray(maintainedContents) || maintainedContents.length === 0)
    return ['missing maintained documentation reference inventory'];
  const report = JSON.parse(await readFile(evidencePath, 'utf8'));
  if (report.mode !== 'capture' || report.dirty !== false)
    return ['documentation media requires an original clean capture'];
  const errors = mediaEvidenceFailures(report, expected);
  if (errors.length) return errors;
  root = await realpath(root);
  const intendedDirectory = path.join(root, `docs/assets/v${expected.version}`);
  let mediaDirectory;
  try {
    mediaDirectory = await realpath(intendedDirectory);
    if (mediaDirectory !== intendedDirectory)
      return ['versioned media directory traverses a symlink'];
  } catch (error) {
    return [`missing candidate media directory: ${error.message}`];
  }
  for (const asset of report.assets) {
    if (asset.decision === 'retire') continue;
    try {
      const intendedFile = path.join(root, asset.path);
      const file = await realpath(intendedFile);
      if (file !== intendedFile || path.dirname(file) !== mediaDirectory)
        throw new Error('asset escaped versioned media directory or traverses a symlink');
      if ((await fileDigest(file)) !== asset.sha256)
        throw new Error('stale or changed media bytes');
    } catch (error) {
      errors.push(`${asset.name}: ${error.message}`);
    }
  }
  errors.push(...staleMediaReferences(maintainedContents, report, expected.version));
  return errors;
}
