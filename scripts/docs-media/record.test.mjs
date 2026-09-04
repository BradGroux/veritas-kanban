import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { recordInteraction } from './record.mjs';

test('recording captures the transition while input is pending and retains verified completion', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'media-recording-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  let state = 'board',
    captures = 0;
  let sawOpening;
  const openingCaptured = new Promise((resolve) => {
    sawOpening = resolve;
  });
  const directory = path.join(root, 'frames');
  const report = await recordInteraction({
    directory,
    fps: 1000,
    framesPerStage: 2,
    capture: async () => {
      const bytes = Buffer.from(`${state}-${captures++}`);
      if (state === 'opening') sawOpening();
      return { bytes };
    },
    stages: [
      { label: 'Board', act: async () => {}, verify: async () => assert.equal(state, 'board') },
      {
        label: 'Open workspace',
        act: async () => {
          state = 'opening';
          await openingCaptured;
          state = 'workspace';
        },
        verify: async () => assert.equal(state, 'workspace'),
      },
    ],
  });
  assert.equal(captures, report.frames.length);
  assert.deepEqual(
    report.events.map((e) => e.label),
    ['Board', 'Open workspace']
  );
  assert.equal(await readFile(path.join(directory, '000000.png'), 'utf8'), 'board-0');
  const samples = await Promise.all(
    report.frames.map((frame) => readFile(path.join(directory, frame.file), 'utf8'))
  );
  assert(
    samples.some((value) => value.startsWith('opening-')),
    'must capture input in progress'
  );
  assert(samples.at(-1).startsWith('workspace-'));
  for (const event of report.events) {
    assert(event.completedAt);
    assert(event.completedFrame >= event.firstFrame);
    assert(event.lastFrame >= event.completedFrame);
  }
  assert.deepEqual(
    JSON.parse(await readFile(path.join(directory, 'recording.json'), 'utf8')),
    report
  );
  await assert.rejects(
    recordInteraction({ directory, capture: async () => {}, stages: [{}, {}] }),
    /EEXIST/
  );
});

test('a failed UI action cannot emit a completed recording', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'media-recording-failure-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const directory = path.join(root, 'frames');
  await assert.rejects(
    recordInteraction({
      directory,
      capture: async () => ({ bytes: Buffer.from('initial-state') }),
      stages: [
        {
          label: 'Open workspace',
          act: async () => {
            throw new Error('dead control');
          },
          verify: async () => {},
        },
        {},
      ],
    }),
    /dead control/
  );
  await assert.rejects(readFile(path.join(directory, 'recording.json')), /ENOENT/);
});

test('a capture failure cannot emit a completed recording', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'media-recording-capture-failure-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const directory = path.join(root, 'frames');
  let captures = 0;
  await assert.rejects(
    recordInteraction({
      directory,
      capture: async () => {
        if (captures++ > 0) throw new Error('native capture failed');
        return { bytes: Buffer.from('initial-state') };
      },
      stages: [{ label: 'Board', act: async () => {}, verify: async () => {} }, {}],
    }),
    /native capture failed/
  );
  await assert.rejects(readFile(path.join(directory, 'recording.json')), /ENOENT/);
});
