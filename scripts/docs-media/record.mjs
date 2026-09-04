import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { setTimeout } from 'node:timers/promises';
import { fileDigest } from '../native-ui/contract.mjs';

// Every frame comes from the live surface before, during, and after UI input. No maintained
// screenshot is an input, and existing recordings are never overwritten.
export async function recordInteraction({
  directory,
  capture,
  stages,
  fps = 8,
  framesPerStage = 8,
}) {
  assert(stages.length >= 2, 'Recording needs an initial state and a completed interaction');
  assert(Number.isFinite(fps) && fps > 0, 'Recording FPS must be positive');
  assert(Number.isInteger(framesPerStage) && framesPerStage > 0, 'Recording needs held frames');
  await mkdir(directory);
  const events = [],
    frames = [];
  for (const stage of stages) {
    const startedAt = new Date().toISOString();
    const event = {
      label: stage.label,
      firstFrame: frames.length,
      startedAt,
    };
    let action,
      actionError,
      completed = false,
      heldFrames = 0;
    const sample = async () => {
      const file = `${String(frames.length).padStart(6, '0')}.png`;
      const captured = await capture();
      await writeFile(path.join(directory, file), captured.bytes, { flag: 'wx' });
      frames.push({
        file,
        capturedAt: new Date().toISOString(),
        sha256: await fileDigest(path.join(directory, file)),
      });
    };
    // Capture the starting state before dispatching input, then keep sampling
    // while actionability checks, menus, transitions, and assertions execute.
    await sample();
    action = (async () => {
      try {
        await stage.act();
        await stage.verify();
        event.completedAt = new Date().toISOString();
        event.completedFrame = frames.length;
      } catch (error) {
        actionError = error;
      } finally {
        completed = true;
      }
    })();
    try {
      while (!completed || heldFrames < framesPerStage) {
        if (actionError) throw actionError;
        const frameStarted = performance.now();
        const wasCompleted = completed;
        await sample();
        if (wasCompleted) heldFrames += 1;
        await setTimeout(Math.max(0, 1000 / fps - (performance.now() - frameStarted)));
      }
    } finally {
      // Do not leave input/assertions running after a capture failure.
      await action;
    }
    if (actionError) throw actionError;
    event.lastFrame = frames.length - 1;
    events.push(event);
  }
  const report = { method: 'interaction-recording', fps, events, frames };
  await writeFile(path.join(directory, 'recording.json'), JSON.stringify(report, null, 2) + '\n', {
    flag: 'wx',
  });
  return report;
}

export function encodeInteraction({ directory, output, fps, width, format = 'gif' }) {
  assert(['gif', 'mp4'].includes(format), 'Unsupported recording format');
  const result = spawnSync(
    'ffmpeg',
    [
      '-n',
      '-hide_banner',
      '-loglevel',
      'error',
      '-framerate',
      String(fps),
      '-i',
      path.join(directory, '%06d.png'),
      ...(format === 'gif'
        ? [
            '-filter_complex',
            `scale=${width}:-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=3`,
            '-loop',
            '0',
          ]
        : [
            '-vf',
            `scale=${width}:-2:flags=lanczos`,
            '-c:v',
            'libx264',
            '-pix_fmt',
            'yuv420p',
            '-movflags',
            '+faststart',
          ]),
      output,
    ],
    { encoding: 'utf8' }
  );
  if (result.error) throw result.error;
  assert.equal(result.status, 0, result.stderr);
}
