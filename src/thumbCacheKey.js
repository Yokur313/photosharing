import { createHash } from 'crypto';
import { joinKey } from './s3.js';

/** Same params as the public share gallery uses for `/s/:id/thumb` (must match for cache hits). */
export const SHARE_GALLERY_THUMB_CACHE = Object.freeze({
  width: 480,
  maxH: 3200,
  fitMode: 'inside',
});

export function thumbCacheObjectKey(folderKey, sourceKey, width, maxH, fitMode) {
  const base = folderKey.replace(/^\//, '').replace(/\/?$/, '/');
  const h = createHash('sha256')
    .update(`${sourceKey}|${width}|${maxH}|${fitMode}`)
    .digest('hex')
    .slice(0, 48);
  return joinKey(base, '.thumbnails', `${h}.jpg`);
}
