import express from 'express';
import archiver from 'archiver';
import multer from 'multer';
import sharp from 'sharp';
import { createHash } from 'crypto';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import {
  putObject,
  joinKey,
  listAllRecursive,
  getEnvConfig,
  getS3,
  objectExists,
  isThumbnailCacheKey,
} from '../s3.js';
import { getShareByIdAsync, verifySharePassword } from '../shareStore.js';

const parseNone = multer().none();

function thumbCacheObjectKey(folderKey, sourceKey, width, maxH, fitMode) {
  const base = folderKey.replace(/^\//, '').replace(/\/?$/, '/');
  const h = createHash('sha256')
    .update(`${sourceKey}|${width}|${maxH}|${fitMode}`)
    .digest('hex')
    .slice(0, 48);
  return joinKey(base, '.thumbnails', `${h}.jpg`);
}

export function createPublicShareRouter(upload) {
  const router = express.Router();

  router.get('/:id/thumb', async (req, res) => {
    const share = await getShareByIdAsync(req.params.id);
    if (!share) return res.status(404).send('Share not found');
    if (share.passwordHash && !req.session[`share:${share.id}:ok`]) {
      return res.status(403).send('Password required');
    }
    const key = (req.query.key || '').toString();
    if (!key || !key.startsWith(share.folderKey.replace(/\/?$/, '/'))) {
      return res.status(400).send('Invalid key');
    }
    if (isThumbnailCacheKey(key)) {
      return res.status(400).send('Invalid key');
    }
    const fitRaw = (req.query.fit || 'cover').toString().toLowerCase();
    const fitMode = fitRaw === 'inside' ? 'inside' : 'cover';
    const width = Math.max(32, Math.min(2048, parseInt(req.query.w, 10) || 256));
    const height = Math.max(32, Math.min(4096, parseInt(req.query.h, 10) || width));
    const maxH = Math.max(64, Math.min(4096, parseInt(req.query.maxh, 10) || 3200));
    const bucketName = getEnvConfig().bucket || process.env.PROD_S3_BUCKET || process.env.S3_BUCKET;
    const cacheDisabled =
      process.env.DISABLE_THUMB_CACHE === '1' || String(process.env.DISABLE_THUMB_CACHE || '').toLowerCase() === 'true';
    const cacheKey = cacheDisabled ? null : thumbCacheObjectKey(share.folderKey, key, width, maxH, fitMode);

    try {
      const s3Client = getS3();
      if (cacheKey && (await objectExists(cacheKey))) {
        const cached = await s3Client.send(new GetObjectCommand({ Bucket: bucketName, Key: cacheKey }));
        res.setHeader('Cache-Control', 'public, max-age=31536000');
        res.setHeader('Content-Type', 'image/jpeg');
        return cached.Body.pipe(res);
      }

      const cmd = new GetObjectCommand({
        Bucket: bucketName,
        Key: key,
      });
      const data = await s3Client.send(cmd);
      const input = Buffer.from(await data.Body.transformToByteArray());
      let pipeline = sharp(input).rotate();
      if (fitMode === 'inside') {
        pipeline = pipeline.resize({
          width,
          height: maxH,
          fit: 'inside',
          withoutEnlargement: true,
        });
      } else {
        pipeline = pipeline.resize({ width, height, fit: 'cover' });
      }
      const outBuf = await pipeline.jpeg({ quality: 70, mozjpeg: true }).toBuffer();
      if (cacheKey) {
        try {
          await putObject(cacheKey, outBuf, 'image/jpeg');
        } catch (e) {
          console.warn('thumb cache write failed', cacheKey, e && e.message);
        }
      }
      res.setHeader('Cache-Control', cacheKey ? 'public, max-age=31536000' : 'public, max-age=86400');
      res.setHeader('Content-Type', 'image/jpeg');
      res.send(outBuf);
    } catch {
      return res.status(500).send('Failed to create thumbnail');
    }
  });

  router.get('/:id/download.zip', async (req, res) => {
    const share = await getShareByIdAsync(req.params.id);
    if (!share) return res.status(404).send('Share not found');
    if (share.passwordHash && !req.session[`share:${share.id}:ok`]) {
      return res.status(403).send('Password required');
    }
    const folderKey = share.folderKey.replace(/\/?$/, '/');
    try {
      const qArrBracket = req.query['keys[]'];
      const qNoBracket = req.query.keys;
      let selected = [];
      if (Array.isArray(qArrBracket) && qArrBracket.length) selected = qArrBracket;
      else if (typeof qArrBracket === 'string' && qArrBracket) selected = [qArrBracket];
      else if (Array.isArray(qNoBracket) && qNoBracket.length) selected = qNoBracket;
      else if (typeof qNoBracket === 'string' && qNoBracket)
        selected = qNoBracket.includes(',') ? qNoBracket.split(',') : [qNoBracket];

      let objects;
      if (selected.length > 0) {
        const base = folderKey;
        const normalized = selected
          .filter((k) => typeof k === 'string' && k.trim().length > 0)
          .map((k) => (k.startsWith(base) ? k : base + k.replace(/^\/+/, '')));
        const valid = normalized.filter((k) => k.startsWith(base));
        if (valid.length === 0) return res.status(400).send('Invalid files');
        const uniq = Array.from(new Set(valid));
        objects = uniq.map((k) => ({ Key: k }));
      } else {
        objects = (await listAllRecursive(folderKey)).filter((o) => o.Key && !isThumbnailCacheKey(o.Key));
      }
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${encodeURIComponent(folderKey.split('/').filter(Boolean).pop() || 'folder')}.zip"`
      );
      req.setTimeout(0);
      res.setTimeout(0);
      const archive = archiver('zip', { zlib: { level: 0 } });
      archive.on('error', () => {
        try {
          res.status(500).end();
        } catch {
          /* ignore */
        }
      });
      archive.pipe(res);
      if (typeof res.flushHeaders === 'function') res.flushHeaders();
      const { bucket: bucketName } = getEnvConfig();
      const s3Client = getS3();
      for (const obj of objects) {
        const objKey = obj.Key;
        const rel = objKey.replace(folderKey, '');
        const cmd = new GetObjectCommand({
          Bucket: bucketName || process.env.PROD_S3_BUCKET || process.env.S3_BUCKET,
          Key: objKey,
        });
        const data = await s3Client.send(cmd);
        archive.append(data.Body, { name: rel });
      }
      await archive.finalize();
    } catch (e) {
      console.error('ZIP error', e);
      return res.status(500).send('Failed to create zip');
    }
  });

  router.post('/:id/download-selected.zip', parseNone, async (req, res) => {
    const share = await getShareByIdAsync(req.params.id);
    if (!share) return res.status(404).send('Share not found');
    if (share.passwordHash && !req.session[`share:${share.id}:ok`]) {
      return res.status(403).send('Password required');
    }
    const rawKeysBody = req.body?.keys;
    const rawKeysArrBody = req.body?.['keys[]'];
    const rawKeysQuery = req.query?.keys;
    const rawKeysArrQuery = req.query?.['keys[]'];
    let keys = [];
    if (Array.isArray(rawKeysArrBody) && rawKeysArrBody.length) keys = rawKeysArrBody;
    else if (typeof rawKeysBody === 'string' && rawKeysBody.length) keys = rawKeysBody.split(',');
    else if (Array.isArray(rawKeysArrQuery) && rawKeysArrQuery.length) keys = rawKeysArrQuery;
    else if (typeof rawKeysQuery === 'string' && rawKeysQuery.length) keys = rawKeysQuery.split(',');
    if (!Array.isArray(keys) || keys.length === 0) return res.status(400).send('No files selected');
    const base = share.folderKey.replace(/\/?$/, '/');
    const validKeys = keys
      .filter((k) => typeof k === 'string' && k.startsWith(base))
      .filter((k) => !isThumbnailCacheKey(k));
    if (validKeys.length === 0) return res.status(400).send('Invalid files');
    try {
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${encodeURIComponent(base.split('/').filter(Boolean).pop() || 'selection')}-selected.zip"`
      );
      req.setTimeout(0);
      res.setTimeout(0);
      const archive = archiver('zip', { zlib: { level: 0 } });
      archive.on('error', () => {
        try {
          res.status(500).end();
        } catch {
          /* ignore */
        }
      });
      archive.pipe(res);
      if (typeof res.flushHeaders === 'function') res.flushHeaders();
      const { bucket: bucketName } = getEnvConfig();
      const s3Client = getS3();
      for (const key of validKeys) {
        const rel = key.replace(base, '');
        const cmd = new GetObjectCommand({
          Bucket: bucketName || process.env.PROD_S3_BUCKET || process.env.S3_BUCKET,
          Key: key,
        });
        const data = await s3Client.send(cmd);
        archive.append(data.Body, { name: rel });
      }
      await archive.finalize();
    } catch (e) {
      console.error('ZIP selected error', e);
      return res.status(500).send('Failed to create zip');
    }
  });

  router.get('/:id', async (req, res) => {
    const share = await getShareByIdAsync(req.params.id);
    if (!share) return res.status(404).send('Share not found');
    if (share.passwordHash && !req.session[`share:${share.id}:ok`]) {
      return res.render('public/enter-password', { id: share.id, error: null });
    }
    try {
      res.render('public/gallery', { share, folders: [], items: [] });
    } catch {
      res.status(500).send('Error loading shared folder');
    }
  });

  router.post('/:id', async (req, res) => {
    const share = await getShareByIdAsync(req.params.id);
    if (!share) return res.status(404).send('Share not found');
    const { password } = req.body;
    if (verifySharePassword(share, password)) {
      req.session[`share:${share.id}:ok`] = true;
      return res.redirect(`/s/${share.id}`);
    }
    return res.status(401).render('public/enter-password', { id: share.id, error: 'Invalid password' });
  });

  router.post('/:id/upload', upload.array('photos'), async (req, res) => {
    const share = await getShareByIdAsync(req.params.id);
    if (!share) return res.status(404).send('Share not found');
    if (share.passwordHash && !req.session[`share:${share.id}:ok`]) {
      return res.status(403).send('Password required');
    }
    if (!share.editable) return res.status(403).send('Uploads disabled');
    try {
      const prefix = share.folderKey.replace(/\/?$/, '/');
      for (const file of req.files || []) {
        const key = joinKey(prefix, file.originalname);
        await putObject(key, file.buffer, file.mimetype);
      }
      res.redirect(`/s/${share.id}`);
    } catch {
      res.status(500).send('Upload failed');
    }
  });

  return router;
}