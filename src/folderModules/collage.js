import { GetObjectCommand } from '@aws-sdk/client-s3';
import sharp from 'sharp';
import { listPrefix, putObject, joinKey, getS3, getEnvConfig, isThumbnailCacheKey } from '../s3.js';
import { userError } from './index.js';

// Only these count as collage input. Mirrors the admin IMAGE_EXT but stays local
// so the module is self-contained.
const IMAGE_EXT = /\.(jpe?g|png|gif|webp|heic|heif|avif|bmp|tiff?)$/i;

// A collage this module produced, e.g. "trip-collage-20261009-143501.jpg".
// Matched so re-runs ignore their own prior output (same folder in, same folder out).
const COLLAGE_NAME_RE = /-collage-\d{8}-\d{6}\.jpg$/i;

const MAX_OUTPUT_DIM = 10000; // px cap on the collage's larger side
const ASPECT_TOLERANCE = 0.03; // 3% — "same aspect ratio" (tolerates slightly different crops)
// Photos are normalized to a common cell sized from the smallest image, so differing
// resolutions don't show in the output — only a genuinely tiny photo hurts quality.
const MIN_PHOTO_SHORT_SIDE = 600; // px floor on the smallest side of any input
const MAX_GRID = 20; // guard against absurd folders (400 photos → 20×20)
const JPEG_QUALITY = 90;

function baseName(key) {
  return key.replace(/\/+$/, '').split('/').pop() || '';
}

function folderName(prefix) {
  return baseName(prefix) || 'folder';
}

function median(nums) {
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function twoDigit(n) {
  return String(n).padStart(2, '0');
}

function timestamp(d = new Date()) {
  return (
    `${d.getFullYear()}${twoDigit(d.getMonth() + 1)}${twoDigit(d.getDate())}` +
    `-${twoDigit(d.getHours())}${twoDigit(d.getMinutes())}${twoDigit(d.getSeconds())}`
  );
}

async function downloadObject(key) {
  const { bucket } = getEnvConfig();
  const s3 = getS3();
  const data = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  return Buffer.from(await data.Body.transformToByteArray());
}

/**
 * Read oriented pixel dimensions without fully decoding. sharp's metadata reports
 * the stored dimensions; for EXIF orientations 5–8 the display axes are swapped.
 */
async function readDimensions(buf, name) {
  let meta;
  try {
    meta = await sharp(buf).metadata();
  } catch {
    throw userError(`"${name}" could not be read as an image. Remove it or move it out of the folder, then retry.`);
  }
  let { width, height } = meta;
  if (!width || !height) {
    throw userError(`"${name}" has no readable dimensions and can't be used in a collage.`);
  }
  if (meta.orientation && meta.orientation >= 5) {
    [width, height] = [height, width];
  }
  return { width, height };
}

async function run({ prefix }) {
  const folderPrefix = (prefix || '').toString();
  if (!folderPrefix || folderPrefix === '/') {
    throw userError('A collage can only be created inside a folder, not at the root.');
  }

  const { files } = await listPrefix(folderPrefix);
  const candidates = (files || [])
    .filter((f) => f.key && !f.key.endsWith('/'))
    .filter((f) => !isThumbnailCacheKey(f.key))
    .map((f) => ({ key: f.key, name: baseName(f.key) }))
    .filter((f) => IMAGE_EXT.test(f.name))
    .filter((f) => !COLLAGE_NAME_RE.test(f.name)) // ignore collages we made before
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

  const n = candidates.length;
  if (n === 0) {
    throw userError('This folder has no photos to collage (previously generated collages are ignored).');
  }

  const k = Math.round(Math.sqrt(n));
  if (k * k !== n || n < 4) {
    throw userError(
      `A collage needs a perfect-square number of photos (4, 9, 16, 25, …). ` +
        `This folder has ${n} photo${n === 1 ? '' : 's'}.`
    );
  }
  if (k > MAX_GRID) {
    throw userError(`That's ${n} photos — too many for one collage (limit ${MAX_GRID * MAX_GRID}).`);
  }

  // Download + measure every photo.
  const photos = [];
  for (const c of candidates) {
    const buf = await downloadObject(c.key);
    const { width, height } = await readDimensions(buf, c.name);
    photos.push({ ...c, buf, width, height, aspect: width / height });
  }

  // Validation 1: all photos share the same aspect ratio (within tolerance).
  // Report every offender (not just the first) so it's clear which photos are to blame.
  const medAspect = median(photos.map((p) => p.aspect));
  const aspectOffenders = photos.filter((p) => Math.abs(p.aspect / medAspect - 1) > ASPECT_TOLERANCE);
  if (aspectOffenders.length) {
    const tolPct = (ASPECT_TOLERANCE * 100).toFixed(1).replace(/\.0$/, '');
    const inTol = photos.length - aspectOffenders.length;
    const details = aspectOffenders
      .map((p) => `"${p.name}" ${p.width}×${p.height} (${p.aspect.toFixed(3)}, ${((p.aspect / medAspect - 1) * 100).toFixed(1)}% off)`)
      .join('; ');
    throw userError(
      `All photos must share the same aspect ratio (within ${tolPct}%). ` +
        `Reference ratio ${medAspect.toFixed(3)} is shared by ${inTol} of ${photos.length} photos. ` +
        `Out of tolerance: ${details}.`
    );
  }

  // Validation 2: nothing is so low-resolution it would make a mushy collage. Differing
  // resolutions are fine (all photos are drawn at a common cell), so we only reject images
  // whose smallest side falls below the floor.
  const tooSmall = photos.filter((p) => Math.min(p.width, p.height) < MIN_PHOTO_SHORT_SIDE);
  if (tooSmall.length) {
    const details = tooSmall.map((p) => `"${p.name}" ${p.width}×${p.height}`).join('; ');
    throw userError(
      `Every photo must be at least ${MIN_PHOTO_SHORT_SIDE}px on its shorter side for a sharp collage. Too small: ${details}.`
    );
  }

  // Cell size: base on the smallest photo so we only ever downscale (no upscaling),
  // then cap the whole collage so its larger side never exceeds MAX_OUTPUT_DIM.
  let cellW = Math.min(...photos.map((p) => p.width));
  let cellH = Math.max(1, Math.round(cellW / medAspect));
  const longestSide = k * Math.max(cellW, cellH);
  if (longestSide > MAX_OUTPUT_DIM) {
    const scale = MAX_OUTPUT_DIM / longestSide;
    cellW = Math.max(1, Math.floor(cellW * scale));
    cellH = Math.max(1, Math.floor(cellH * scale));
  }
  const outW = cellW * k;
  const outH = cellH * k;

  // Resize each photo to the exact cell (fit: 'fill' — never crops; aspect is already
  // equal within ASPECT_TOLERANCE, so any stretch stays within that bound), then tile.
  const composites = [];
  for (let i = 0; i < photos.length; i += 1) {
    const cell = await sharp(photos[i].buf)
      .rotate()
      .resize(cellW, cellH, { fit: 'fill' })
      .toBuffer();
    composites.push({ input: cell, left: (i % k) * cellW, top: Math.floor(i / k) * cellH });
  }

  const outBuf = await sharp({
    create: { width: outW, height: outH, channels: 3, background: { r: 255, g: 255, b: 255 } },
  })
    .composite(composites)
    .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
    .toBuffer();

  const outName = `${folderName(folderPrefix)}-collage-${timestamp()}.jpg`;
  const outKey = joinKey(folderPrefix, outName);
  await putObject(outKey, outBuf, 'image/jpeg');

  return {
    message: `Collage created: ${outName} — ${k}×${k} grid, ${outW}×${outH}px, from ${n} photos.`,
    resultKey: outKey,
    resultName: outName,
  };
}

export const collageModule = {
  id: 'collage',
  label: 'Create collage',
  description: 'Stitch all photos in this folder into a square grid (no cropping) and save it back here.',
  run,
};
