import express from 'express';
import {
  listPrefix,
  putObject,
  deleteObject,
  copyObject,
  joinKey,
  signGetUrl,
  createFolder,
  deleteFolderRecursive,
  isThumbnailCacheKey,
} from '../s3.js';
import { listSharesAsync, createShareAsync, deleteShareAsync, getLatestShareForFolderPrefix } from '../shareStore.js';
import { requireAdmin } from '../middleware/auth.js';
import { SHARE_GALLERY_THUMB_CACHE, thumbCacheObjectKey } from '../thumbCacheKey.js';

const IMAGE_EXT = /\.(jpe?g|png|gif|webp|heic|heif|avif|bmp|tiff?)$/i;

function isImageFileName(name) {
  return IMAGE_EXT.test(name || '');
}

function normalizeShareFolderPrefix(fk) {
  let s = (fk || '').replace(/^\//, '');
  if (!s) return '';
  return s.endsWith('/') ? s : `${s}/`;
}

/** Longest share folder prefix that contains this object key (share thumbnails live under that root). */
function longestShareRootForObjectKey(objectKey, shares) {
  const k = objectKey.replace(/^\//, '');
  let best = null;
  let bestLen = 0;
  for (const s of shares) {
    const fk = normalizeShareFolderPrefix(s.folderKey);
    if (!fk) continue;
    const matches = k === fk.slice(0, -1) || k.startsWith(fk);
    if (matches && fk.length > bestLen) {
      best = fk;
      bestLen = fk.length;
    }
  }
  return best;
}

function thumbListPrefixForShareRoot(shareRoot) {
  const base = shareRoot.replace(/^\//, '').replace(/\/?$/, '');
  return `${joinKey(base, '.thumbnails')}/`;
}

function isAppMetadataKey(k) {
  const normalized = (k || '').replace(/^\//, '');
  if (normalized === '__app_metadata__' || normalized.startsWith('__app_metadata__/')) return true;
  return isThumbnailCacheKey(k);
}

function formatSize(bytes) {
  if (bytes < 100 * 1024) {
    const kb = Math.max(1, Math.round(bytes / 1024));
    return `${kb} KB`;
  }
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(1)} MB`;
}

export function createAdminRouter(upload) {
  const router = express.Router();

  router.get('/', requireAdmin, async (req, res) => {
    const prefix = (req.query.prefix || '').toString();
    try {
      const { folders, files } = await listPrefix(prefix);
      const folderEntries = (folders || [])
        .filter((f) => !isAppMetadataKey(f))
        .map((f) => ({
          type: 'folder',
          key: f,
          name: f.replace(prefix, '').replace(/\/$/, ''),
          size: null,
          lastModified: null,
        }));
      const fileEntriesRaw = (files || [])
        .filter((o) => !isAppMetadataKey(o.key))
        .map((o) => ({
          type: 'file',
          key: o.key,
          name: o.key.replace(prefix, ''),
          size: o.size,
          sizeDisplay: formatSize(o.size || 0),
          lastModified: o.lastModified,
        }));
      const shares = await listSharesAsync();
      const shareRootByKey = new Map();
      for (const fe of fileEntriesRaw) {
        if (!isImageFileName(fe.name)) continue;
        const root = longestShareRootForObjectKey(fe.key, shares);
        if (root) shareRootByKey.set(fe.key, root);
      }
      const rootsNeeded = new Set(shareRootByKey.values());
      const cachedThumbKeys = new Set();
      for (const root of rootsNeeded) {
        try {
          const { files: tf } = await listPrefix(thumbListPrefixForShareRoot(root));
          (tf || []).forEach((f) => cachedThumbKeys.add(f.key));
        } catch {
          /* ignore */
        }
      }
      const { width: tw, maxH: tmh, fitMode: tfit } = SHARE_GALLERY_THUMB_CACHE;
      const fileEntries = [];
      for (const fe of fileEntriesRaw) {
        let thumbPreviewUrl = null;
        let thumbPending = false;
        const shareRoot = shareRootByKey.get(fe.key);
        if (shareRoot) {
          const ck = thumbCacheObjectKey(shareRoot, fe.key, tw, tmh, tfit);
          if (cachedThumbKeys.has(ck)) {
            try {
              thumbPreviewUrl = await signGetUrl(ck, 3600);
            } catch {
              thumbPreviewUrl = null;
            }
          } else {
            thumbPending = true;
          }
        }
        try {
          const url = await signGetUrl(fe.key, 3600);
          fileEntries.push({ ...fe, url, thumbPreviewUrl, thumbPending });
        } catch {
          fileEntries.push({ ...fe, url: null, thumbPreviewUrl, thumbPending });
        }
      }
      const entries = [...folderEntries, ...fileEntries];
      const crumbs = [];
      const parts = (prefix || '').replace(/\/$/, '').split('/').filter(Boolean);
      let walk = '';
      crumbs.push({ name: 'Root', prefix: '' });
      for (const p of parts) {
        walk = walk ? `${walk}/${p}` : p;
        crumbs.push({ name: p, prefix: `${walk}/` });
      }
      const latestShare = await getLatestShareForFolderPrefix(prefix, shares);
      res.render('admin/index', { prefix, entries, crumbs, latestShare });
    } catch (e) {
      console.error('Error listing objects', e);
      res.status(500).send('Error listing objects');
    }
  });

  router.post('/upload', requireAdmin, upload.array('photos'), async (req, res) => {
    const prefix = (req.body.prefix || '').toString();
    try {
      for (const file of req.files || []) {
        const key = joinKey(prefix, file.originalname);
        await putObject(key, file.buffer, file.mimetype);
      }
      res.redirect(`/admin?prefix=${encodeURIComponent(prefix)}`);
    } catch {
      res.status(500).send('Upload failed');
    }
  });

  router.post('/delete', requireAdmin, async (req, res) => {
    const { key } = req.body;
    if (isAppMetadataKey(key)) {
      return res.status(403).send('Cannot delete application metadata from this UI');
    }
    try {
      await deleteObject(key);
      const parent = key.includes('/') ? key.slice(0, key.lastIndexOf('/')) : '';
      res.redirect(`/admin?prefix=${encodeURIComponent(parent)}`);
    } catch {
      res.status(500).send('Delete failed');
    }
  });

  router.post('/move', requireAdmin, async (req, res) => {
    const { fromKey, toFolder } = req.body;
    if (isAppMetadataKey(fromKey) || isAppMetadataKey(toFolder)) {
      return res.status(403).send('Cannot move into or out of application metadata');
    }
    try {
      const fileName = fromKey.split('/').pop();
      const toKey = joinKey(toFolder, fileName);
      await copyObject(fromKey, toKey);
      await deleteObject(fromKey);
      res.redirect(`/admin?prefix=${encodeURIComponent(toFolder)}`);
    } catch {
      res.status(500).send('Move failed');
    }
  });

  router.post('/folder/create', requireAdmin, async (req, res) => {
    const { prefix, name } = req.body;
    try {
      await createFolder(joinKey(prefix || '', name));
      res.redirect(`/admin?prefix=${encodeURIComponent(prefix || '')}`);
    } catch {
      res.status(500).send('Folder create failed');
    }
  });

  router.post('/folder/delete', requireAdmin, async (req, res) => {
    const { prefix: folderPrefix } = req.body;
    if (isAppMetadataKey(folderPrefix)) {
      return res.status(403).send('Cannot delete application metadata tree');
    }
    try {
      const parent = (folderPrefix || '').split('/').slice(0, -2).join('/');
      await deleteFolderRecursive(folderPrefix);
      res.redirect(`/admin?prefix=${encodeURIComponent(parent)}`);
    } catch {
      res.status(500).send('Folder delete failed');
    }
  });

  router.post('/share/create', requireAdmin, async (req, res) => {
    const { folderKey, password, editable } = req.body;
    if (!folderKey) return res.status(400).json({ error: 'folderKey required' });
    try {
      const share = await createShareAsync({ folderKey, password, editable: !!editable });
      return res.json({ id: share.id, url: `/s/${share.id}` });
    } catch {
      return res.status(500).json({ error: 'Failed to create share' });
    }
  });

  router.get('/sign', requireAdmin, async (req, res) => {
    const key = (req.query.key || '').toString();
    if (!key) return res.status(400).json({ error: 'key required' });
    if (isAppMetadataKey(key)) return res.status(403).json({ error: 'forbidden' });
    try {
      const url = await signGetUrl(key, 3600);
      return res.json({ url });
    } catch {
      return res.status(500).json({ error: 'Failed to sign' });
    }
  });

  router.get('/shares', requireAdmin, async (req, res) => {
    res.render('admin/shares', { shares: await listSharesAsync() });
  });

  router.post('/shares', requireAdmin, async (req, res) => {
    const { folderKey, password, editable } = req.body;
    const allowUpload = editable === '1' || editable === 'on' || editable === true;
    await createShareAsync({ folderKey, password, editable: allowUpload });
    res.redirect('/admin/shares');
  });

  router.post('/shares/delete', requireAdmin, async (req, res) => {
    const { id } = req.body;
    await deleteShareAsync(id);
    res.redirect('/admin/shares');
  });

  return router;
}
