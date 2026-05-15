import express from 'express';
import { listPrefix, signGetUrl } from '../s3.js';
import { getShareByIdAsync } from '../shareStore.js';

const router = express.Router();

function shareSessionOk(req, share) {
  if (!share.passwordHash) return true;
  return Boolean(req.session[`share:${share.id}:ok`]);
}

/** Paginated file list + presigned URLs (session cookie for password shares). */
router.get('/share/:id/items', async (req, res) => {
  const share = await getShareByIdAsync(req.params.id);
  if (!share) return res.status(404).json({ error: 'not_found' });
  if (share.passwordHash && !shareSessionOk(req, share)) {
    return res.status(403).json({ error: 'password_required' });
  }
  const offset = Math.max(0, parseInt(String(req.query.offset || '0'), 10) || 0);
  const limit = Math.min(80, Math.max(1, parseInt(String(req.query.limit || '40'), 10) || 40));
  try {
    const { files } = await listPrefix(share.folderKey);
    const total = files.length;
    const slice = files.slice(offset, offset + limit);
    const items = [];
    for (const f of slice) {
      const url = await signGetUrl(f.key, 3600);
      items.push({ key: f.key, name: f.key.split('/').pop(), size: f.size, url });
    }
    res.json({
      id: share.id,
      folderKey: share.folderKey,
      editable: !!share.editable,
      items,
      total,
      offset,
      limit,
      hasMore: offset + items.length < total,
    });
  } catch {
    res.status(500).json({ error: 'server_error' });
  }
});

/** Full list (legacy); prefer /items for large folders. */
router.get('/share/:id', async (req, res) => {
  const share = await getShareByIdAsync(req.params.id);
  if (!share) return res.status(404).json({ error: 'not_found' });
  if (share.passwordHash && !shareSessionOk(req, share)) {
    return res.status(403).json({ error: 'password_required' });
  }
  try {
    const { files } = await listPrefix(share.folderKey);
    const items = [];
    for (const f of files) {
      const url = await signGetUrl(f.key, 3600);
      items.push({ key: f.key, name: f.key.split('/').pop(), size: f.size, url });
    }
    res.json({ id: share.id, folderKey: share.folderKey, editable: !!share.editable, items });
  } catch {
    res.status(500).json({ error: 'server_error' });
  }
});

export const apiRoutes = router;
