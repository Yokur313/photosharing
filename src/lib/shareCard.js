import { listPrefixCached, isThumbnailCacheKey } from '../s3.js';

const SITE_NAME = 'Arthur Stainmesse · Photos';
const IMAGE_RE = /\.(jpe?g|png|webp|gif|avif|tiff?)$/i;
const COVER_TTL_MS = 10 * 60 * 1000;
const coverCache = new Map();

export function folderTitle(folderKey) {
  const parts = String(folderKey || '')
    .split('/')
    .map((s) => s.trim())
    .filter(Boolean);
  return parts[parts.length - 1] || 'Shared photos';
}

export function publicBaseUrl(req) {
  const fromEnv = (process.env.PUBLIC_BASE_URL || '').trim().replace(/\/+$/, '');
  if (fromEnv) return fromEnv;
  const proto = (req.get('x-forwarded-proto') || req.protocol || 'http').split(',')[0].trim();
  return `${proto}://${req.get('host')}`;
}

async function findCoverKey(share) {
  const hit = coverCache.get(share.id);
  if (hit && Date.now() - hit.at < COVER_TTL_MS) return { key: hit.key, fresh: false };
  try {
    const { files } = await listPrefixCached(share.folderKey);
    const cover = files.find((f) => !isThumbnailCacheKey(f.key) && IMAGE_RE.test(f.key));
    const key = cover ? cover.key : null;
    coverCache.set(share.id, { key, at: Date.now() });
    return { key, fresh: true };
  } catch {
    return { key: null, fresh: false };
  }
}

function coverImagePath(share, key) {
  return (
    `/s/${encodeURIComponent(share.id)}/thumb?key=${encodeURIComponent(key)}` + '&w=1200&h=630&maxh=630&fit=cover'
  );
}

// The first request for a cover makes the server download the original and resize it (several seconds).
// Requesting it ourselves ahead of time caches it, so a chat app's link crawler doesn't time out waiting.
const warming = new Set();
function warmCoverImage(share, key) {
  const path = coverImagePath(share, key);
  if (warming.has(path)) return;
  warming.add(path);
  const port = process.env.PROD_PORT || process.env.PORT || 3000;
  fetch(`http://127.0.0.1:${port}${path}`)
    .then((r) => r.arrayBuffer())
    .catch(() => {})
    .finally(() => warming.delete(path));
}

export async function warmShareCard(share) {
  if (share.passwordHash) return;
  const { key } = await findCoverKey(share);
  if (key) warmCoverImage(share, key);
}

// Link-preview data (Open Graph) for a share page. Password-protected shares get no image.
export async function buildShareCard(req, share) {
  const base = publicBaseUrl(req);
  const locked = Boolean(share.passwordHash);
  const card = {
    siteName: SITE_NAME,
    title: folderTitle(share.folderKey),
    description: locked
      ? 'A password-protected photo folder shared by Arthur Stainmesse. Open the link and enter the password to browse and download the photos.'
      : 'A photo folder shared by Arthur Stainmesse. Open the link to browse the photos and download them in full quality.',
    url: base + req.originalUrl.split('?')[0],
    image: null,
  };
  if (!locked) {
    const { key, fresh } = await findCoverKey(share);
    if (key) {
      card.image = base + coverImagePath(share, key);
      if (fresh) warmCoverImage(share, key);
    }
  }
  return card;
}
