import express from 'express';
import { listPrefix, signGetUrl } from '../s3.js';
import { getShareByIdAsync } from '../shareStore.js';

const router = express.Router();

router.get('/share/:id', async (req, res) => {
  const share = await getShareByIdAsync(req.params.id);
  if (!share) return res.status(404).json({ error: 'not_found' });
  if (share.passwordHash) return res.status(403).json({ error: 'password_required' });
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
