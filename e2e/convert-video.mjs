/**
 * Converts the newest Playwright demo recording (webm) to docs/demo.mp4
 * using the bundled ffmpeg-static binary — no system ffmpeg required.
 * Falls back to copying the webm if conversion is impossible.
 */
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const resultsDir = join(root, 'test-results');

function findNewestWebm(dir) {
  let newest = null;
  for (const entry of readdirSync(dir, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.webm')) continue;
    const path = join(entry.parentPath ?? entry.path, entry.name);
    const mtime = statSync(path).mtimeMs;
    if (!newest || mtime > newest.mtime) newest = { path, mtime };
  }
  return newest?.path ?? null;
}

const webm = findNewestWebm(resultsDir);
if (!webm) {
  console.error('No .webm recording found under test-results/ — did the demo run?');
  process.exit(1);
}

mkdirSync(join(root, 'docs'), { recursive: true });
const mp4 = join(root, 'docs', 'demo.mp4');

let ffmpeg = null;
try {
  ffmpeg = (await import('ffmpeg-static')).default;
} catch {
  ffmpeg = null;
}

if (ffmpeg) {
  execFileSync(ffmpeg, [
    '-y',
    '-i',
    webm,
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-movflags',
    '+faststart',
    '-crf',
    '22',
    mp4,
  ]);
  console.log(`Demo video written to docs/demo.mp4 (${webm})`);
} else {
  const fallback = join(root, 'docs', 'demo.webm');
  copyFileSync(webm, fallback);
  console.log(`ffmpeg-static unavailable — copied raw recording to docs/demo.webm`);
}
