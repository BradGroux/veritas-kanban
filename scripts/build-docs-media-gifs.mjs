#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { copyFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const assets = resolve(root, 'docs/assets/v6.1.6');

function buildGif({ inputs, output, width, seconds }) {
  const args = ['-y', '-hide_banner', '-loglevel', 'error'];
  for (const input of inputs) {
    args.push(
      '-framerate',
      '10',
      '-loop',
      '1',
      '-t',
      String(seconds),
      '-i',
      resolve(assets, input)
    );
  }

  const streams = inputs.map((_, index) => `[${index}:v]`).join('');
  const filter =
    `${streams}concat=n=${inputs.length}:v=1:a=0,fps=10,scale=${width}:-1:flags=lanczos,split[a][b];` +
    '[a]palettegen=max_colors=128:stats_mode=diff[p];' +
    '[b][p]paletteuse=dither=bayer:bayer_scale=3';

  args.push('-filter_complex', filter, '-loop', '0', resolve(assets, output));
  const result = spawnSync('ffmpeg', args, { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`ffmpeg exited with status ${result.status}`);
}

function buildVideo({ inputs, output, seconds }) {
  const args = ['-y', '-hide_banner', '-loglevel', 'error'];
  for (const input of inputs) {
    args.push(
      '-framerate',
      '30',
      '-loop',
      '1',
      '-t',
      String(seconds),
      '-i',
      resolve(assets, input)
    );
  }

  const prepared = inputs
    .map(
      (_, index) =>
        `[${index}:v]scale=1037:720:flags=lanczos,pad=1280:720:(ow-iw)/2:0:black,setsar=1[v${index}]`
    )
    .join(';');
  const streams = inputs.map((_, index) => `[v${index}]`).join('');
  const filter = `${prepared};${streams}concat=n=${inputs.length}:v=1:a=0,format=yuv420p[out]`;

  args.push(
    '-filter_complex',
    filter,
    '-map',
    '[out]',
    '-c:v',
    'libx264',
    '-crf',
    '22',
    '-movflags',
    '+faststart',
    '-r',
    '30',
    output
  );
  const result = spawnSync('ffmpeg', args, { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`ffmpeg exited with status ${result.status}`);
}

buildGif({
  inputs: [
    'board-overview.png',
    'task-workspace.png',
    'settings-navigation.png',
    'agent-providers.png',
    'command-palette.png',
  ],
  output: 'board-to-workspace.gif',
  width: 1200,
  seconds: 1.5,
});

buildGif({
  inputs: ['mobile-board.png', 'mobile-task-workspace.png', 'mobile-settings.png'],
  output: 'mobile-flow.gif',
  width: 390,
  seconds: 1.75,
});

const desktopTour = [
  'board-overview.png',
  'task-workspace.png',
  'settings-navigation.png',
  'agent-providers.png',
  'command-palette.png',
];

const sourceVideo = resolve(root, 'assets/demo-overview.mp4');
buildVideo({ inputs: desktopTour, output: sourceVideo, seconds: 2 });
copyFileSync(sourceVideo, resolve(root, 'docs/assets/demo-overview.mp4'));

console.log('Documentation GIFs and demo video regenerated from the current screenshot set.');
