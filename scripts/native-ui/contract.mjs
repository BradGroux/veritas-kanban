import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readdir, readlink, realpath } from 'node:fs/promises';
import path from 'node:path';

export const schema = 'packaged-macos-ui-conformance/v1';
export const routes = [
  ['activity', '/activity', 'Activity'],
  ['backlog', '/backlog', 'Backlog'],
  ['archive', '/archive', 'Archive'],
  ['templates', '/templates', 'Task Templates'],
  ['workflows', '/workflows', 'Workflows'],
  ['operations', '/operations', 'Operations Digest'],
  ['evidence', '/evidence', 'Evidence Timeline'],
  ['time', '/time', 'Time Breakdowns'],
  ['drift', '/drift', 'Behavioral Drift Monitor'],
  ['decisions', '/decisions', 'Decision Audit Trail'],
  ['scoring', '/scoring', 'Agent Output Scoring'],
  ['policies', '/policies', 'Agent Policies'],
];
export const settingsSections = [
  'General',
  'Tasks',
  'Notifications',
  'Scheduler',
  'Security',
  'Maintenance',
];
export const modes = ['light', 'dark'].flatMap((theme) => [
  { id: `${theme}-normal`, theme, width: 1700, height: 1000 },
  { id: `${theme}-minimum`, theme, width: 1180, height: 760 },
]);
// The runner cannot reduce this list when a scenario fails or is not implemented.
export const states = [
  'board',
  'left-rail',
  'right-rail',
  'board-chat',
  'squad-chat',
  'task-chat',
  ...routes.map(([id]) => `route-${id}`),
  ...settingsSections.map((label) => `settings-${label.toLowerCase()}`),
  'create-task',
  'create-template',
  'edit-template',
  'search',
  'command-palette',
  'task-drawer',
  'task-expanded',
  'preview',
  'confirmation',
  'header-controls',
  'responsive-collapse',
  'relaunch',
];
export const requiredEntries = modes.flatMap((mode) =>
  states.map((state) => `${mode.id}/${state}`)
);
export function requiresOverlay(id) {
  const state = id.split('/')[1];
  return (
    state?.startsWith('settings-') ||
    [
      'task-chat',
      'task-drawer',
      'task-expanded',
      'create-task',
      'create-template',
      'edit-template',
      'search',
      'command-palette',
      'preview',
      'confirmation',
    ].includes(state)
  );
}

export async function fileDigest(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

// Hash the whole bundle, including packaged web/server resources and native binaries,
// not just app.asar. Symlink text is included without following framework cycles.
export async function packageDigest(directory) {
  directory = await realpath(directory);
  const hash = createHash('sha256');
  async function walk(relative) {
    const absolute = path.join(directory, relative);
    const stat = await lstat(absolute);
    if (stat.isSymbolicLink()) {
      const target = path.relative(directory, await realpath(absolute));
      if (target === '..' || target.startsWith(`..${path.sep}`) || path.isAbsolute(target))
        throw new Error(`Package symlink escapes bundle: ${relative}`);
      hash.update(JSON.stringify([relative, 'link', await readlink(absolute)]));
    } else if (stat.isDirectory()) {
      hash.update(JSON.stringify([relative, 'directory']));
      for (const child of (await readdir(absolute)).sort()) await walk(path.join(relative, child));
    } else if (stat.isFile())
      hash.update(JSON.stringify([relative, stat.mode & 0o777, await fileDigest(absolute)]));
    else throw new Error(`Unsupported package entry: ${relative}`);
  }
  await walk('');
  return hash.digest('hex');
}

export function geometryFailures(g) {
  if (!g) return ['missing geometry'];
  const failures = [];
  const validRect = (r) =>
    [r.x, r.y, r.width, r.height, r.right, r.bottom].every(Number.isFinite) &&
    r.width > 0 &&
    r.height > 0 &&
    Math.abs(r.right - r.x - r.width) <= 1 &&
    Math.abs(r.bottom - r.y - r.height) <= 1;
  if (
    ![
      g.width,
      g.height,
      g.scrollWidth,
      g.scrollHeight,
      g.shell?.x,
      g.shell?.y,
      g.shell?.width,
      g.shell?.height,
    ].every(Number.isFinite)
  )
    return ['invalid geometry'];
  if (g.scrollWidth > g.width + 1 || g.scrollHeight > g.height + 1)
    failures.push('document shell overflow');
  if (
    Math.abs(g.shell.x) > 1 ||
    Math.abs(g.shell.y) > 1 ||
    Math.abs(g.shell.width - g.width) > 1 ||
    Math.abs(g.shell.height - g.height) > 1
  )
    failures.push('shell does not fill viewport');
  for (const overlay of g.overlays ?? []) {
    if (!validRect(overlay) || !Number.isFinite(overlay.overflow))
      failures.push('unmeasured overlay');
    if (!Number.isFinite(overlay.opacity) || overlay.opacity < 0.999 || overlay.opacity > 1)
      failures.push('transparent or unmeasured overlay');
    if (
      !Array.isArray(overlay.parts) ||
      !['header', 'body'].every((name) => overlay.parts.some((part) => part.name === name))
    )
      failures.push('missing overlay header/body');
    if (
      overlay.x < 0 ||
      overlay.y < 0 ||
      overlay.right > g.width + 1 ||
      overlay.bottom > g.height + 1 ||
      overlay.overflow > 1
    )
      failures.push('clipped overlay');
    for (const part of overlay.parts ?? []) {
      if (
        !validRect(part) ||
        part.x < overlay.x - 1 ||
        part.y < overlay.y - 1 ||
        part.right > overlay.right + 1 ||
        part.bottom > overlay.bottom + 1 ||
        !Array.isArray(part.padding) ||
        part.padding.length !== 4 ||
        !part.padding.every((value) => Number.isFinite(value) && value >= 0)
      )
        failures.push(`unreachable or unmeasured overlay ${part.name}`);
    }
  }
  return failures;
}

export function evidenceFailures(report, expected, now = Date.now()) {
  const errors = [];
  if (report?.schema !== schema) return ['unknown or missing native evidence schema'];
  if (report.status !== 'passed') errors.push('native run did not pass');
  if (
    report.boundary !== 'packaged-macos' ||
    report.identity?.packaged !== true ||
    report.identity?.platform !== 'darwin'
  )
    errors.push('not a packaged macOS run');
  if (report.identity?.buildIdentity !== expected.commit || report.commit !== expected.commit)
    errors.push('candidate commit mismatch');
  if (report.packageDigest !== expected.packageDigest) errors.push('candidate package mismatch');
  if (report.version !== expected.version || report.identity?.version !== expected.version)
    errors.push('candidate version mismatch');
  if (report.dirty !== false) errors.push('candidate checkout was dirty');
  const completed = Date.parse(report.completedAt);
  if (!Number.isFinite(completed) || completed > now || now - completed > 24 * 60 * 60 * 1000)
    errors.push('missing or stale native evidence');
  const entries = report.entries ?? [];
  if (
    entries.length !== requiredEntries.length ||
    new Set(entries.map((e) => e.id)).size !== requiredEntries.length
  )
    errors.push('duplicate or incomplete native matrix');
  for (const id of requiredEntries) {
    const entry = entries.find((e) => e.id === id);
    if (!entry || entry.status !== 'passed') {
      errors.push(`${id}: missing or failed`);
      continue;
    }
    const mode = modes.find((m) => id.startsWith(`${m.id}/`));
    if (
      entry.theme !== mode.theme ||
      entry.geometry?.width !== mode.width ||
      entry.geometry?.height !== mode.height ||
      entry.completionGeometry?.width !== mode.width ||
      entry.completionGeometry?.height !== mode.height
    )
      errors.push(`${id}: wrong theme or dimensions`);
    if (!entry.screenshot?.path || !/^[a-f0-9]{64}$/.test(entry.screenshot.sha256 ?? ''))
      errors.push(`${id}: missing screenshot`);
    const native = entry.nativeWindow;
    const validBounds = (bounds) =>
      bounds &&
      [bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite) &&
      bounds.width > 0 &&
      bounds.height > 0;
    if (
      !Number.isFinite(native?.scaleFactor) ||
      native.scaleFactor <= 0 ||
      !validBounds(native?.bounds) ||
      !validBounds(native?.contentBounds) ||
      native.contentBounds.width !== entry.geometry?.width ||
      native.contentBounds.height !== entry.geometry?.height ||
      !report.identity?.osVersion
    )
      errors.push(`${id}: missing native environment`);
    if (requiresOverlay(id) && !entry.geometry?.overlays?.length)
      errors.push(`${id}: missing required overlay`);
    errors.push(...geometryFailures(entry.geometry).map((error) => `${id}: ${error}`));
    errors.push(
      ...geometryFailures(entry.completionGeometry).map(
        (error) => `${id}: after interaction: ${error}`
      )
    );
  }
  return errors;
}
