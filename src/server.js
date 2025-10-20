import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.join(process.cwd(), '.env') });

import express from 'express';
import session from 'express-session';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import jwt from 'jsonwebtoken';
import archiver from 'archiver';
import multer from 'multer';
import { listPrefix, putObject, deleteObject, copyObject, joinKey, signGetUrl, createFolder, deleteFolderRecursive, listAllRecursive, getEnvConfig, getS3 } from './s3.js';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { listShares, createShare, deleteShare as removeShare, getShareById, verifySharePassword, listSharesAsync, getShareByIdAsync, createShareAsync, deleteShareAsync } from './shareStore.js';
import expressLayouts from 'express-ejs-layouts';
import sharp from 'sharp';

const app = express();

app.set('view engine', 'ejs');
app.set('views', path.join(process.cwd(), 'src', 'views'));
app.use(expressLayouts);
app.set('layout', 'layout');
app.use('/public', express.static(path.join(process.cwd(), 'public')));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser());

// CORS for GitHub Pages
app.use(cors({
  origin: ['https://yokur313.github.io', 'http://localhost:3000'],
  credentials: false
}));

app.use(
  session({
    secret: process.env.PROD_SESSION_SECRET || process.env.SESSION_SECRET || 'dev-secret',
    resave: false,
    saveUninitialized: false,
  })
);

app.get('/', (req, res) => {
  res.redirect('/login');
});

app.get('/healthz', (req, res) => {
  res.json({ ok: true });
});

app.get('/login', (req, res) => {
  res.render('login', { error: null });
});

app.post('/login', (req, res) => {
  const { password } = req.body;
  if (((process.env.PROD_ADMIN_PASSWORD || process.env.ADMIN_PASSWORD) || '') && password === (process.env.PROD_ADMIN_PASSWORD || process.env.ADMIN_PASSWORD)) {
    req.session.isAdmin = true;
    // Issue JWT cookie valid for 30 days
    const token = jwt.sign({ role: 'admin' }, process.env.PROD_SESSION_SECRET || process.env.SESSION_SECRET || 'dev-secret', { expiresIn: '30d' });
    res.cookie('admin_jwt', token, { httpOnly: true, sameSite: 'lax', maxAge: 1000*60*60*24*30 });
    return res.redirect('/admin');
  }
  return res.status(401).render('login', { error: 'Invalid password' });
});

function requireAdmin(req, res, next) {
  if (req.session && req.session.isAdmin) return next();
  const token = req.cookies && req.cookies.admin_jwt;
  if (token) {
    try {
      const payload = jwt.verify(token, process.env.PROD_SESSION_SECRET || process.env.SESSION_SECRET || 'dev-secret');
      if (payload && payload.role === 'admin') {
        req.session.isAdmin = true;
        return next();
      }
    } catch (_) {}
  }
  return res.redirect('/login');
}

app.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

// Admin dashboard: list folders/files under a prefix
app.get('/admin', requireAdmin, async (req, res) => {
  const prefix = (req.query.prefix || '').toString();
  try {
    const { folders, files } = await listPrefix(prefix);
    const folderEntries = (folders || []).map(f => ({
      type: 'folder',
      key: f,
      name: f.replace(prefix, '').replace(/\/$/, ''),
      size: null,
      lastModified: null,
    }));
    function formatSize(bytes) {
      if (bytes < 100 * 1024) {
        const kb = Math.max(1, Math.round(bytes / 1024));
        return `${kb} KB`;
      }
      const mb = bytes / (1024 * 1024);
      return `${mb.toFixed(1)} MB`;
    }
    const fileEntriesRaw = (files || []).map(o => ({
      type: 'file',
      key: o.key,
      name: o.key.replace(prefix, ''),
      size: o.size,
      sizeDisplay: formatSize(o.size || 0),
      lastModified: o.lastModified,
    }));
    // presign urls for preview
    const fileEntries = [];
    for (const fe of fileEntriesRaw) {
      try {
        const url = await signGetUrl(fe.key, 3600);
        fileEntries.push({ ...fe, url });
      } catch (_) {
        fileEntries.push({ ...fe, url: null });
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
    res.render('admin/index', { prefix, entries, crumbs });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('Error listing objects', e);
    res.status(500).send('Error listing objects');
  }
});

const upload = multer({ storage: multer.memoryStorage() });

app.post('/admin/upload', requireAdmin, upload.array('photos'), async (req, res) => {
  const prefix = (req.body.prefix || '').toString();
  try {
    for (const file of req.files || []) {
      const key = joinKey(prefix, file.originalname);
      await putObject(key, file.buffer, file.mimetype);
    }
    res.redirect(`/admin?prefix=${encodeURIComponent(prefix)}`);
  } catch (e) {
    res.status(500).send('Upload failed');
  }
});

app.post('/admin/delete', requireAdmin, async (req, res) => {
  const { key } = req.body;
  try {
    await deleteObject(key);
    const parent = key.includes('/') ? key.slice(0, key.lastIndexOf('/')) : '';
    res.redirect(`/admin?prefix=${encodeURIComponent(parent)}`);
  } catch (e) {
    res.status(500).send('Delete failed');
  }
});

app.post('/admin/move', requireAdmin, async (req, res) => {
  const { fromKey, toFolder } = req.body;
  try {
    const fileName = fromKey.split('/').pop();
    const toKey = joinKey(toFolder, fileName);
    await copyObject(fromKey, toKey);
    await deleteObject(fromKey);
    res.redirect(`/admin?prefix=${encodeURIComponent(toFolder)}`);
  } catch (e) {
    res.status(500).send('Move failed');
  }
});

app.post('/admin/folder/create', requireAdmin, async (req, res) => {
  const { prefix, name } = req.body;
  try {
    await createFolder(joinKey(prefix || '', name));
    res.redirect(`/admin?prefix=${encodeURIComponent(prefix || '')}`);
  } catch (e) {
    res.status(500).send('Folder create failed');
  }
});

app.post('/admin/folder/delete', requireAdmin, async (req, res) => {
  const { prefix } = req.body; // folder key
  try {
    const parent = (prefix || '').split('/').slice(0, -2).join('/');
    await deleteFolderRecursive(prefix);
    res.redirect(`/admin?prefix=${encodeURIComponent(parent)}`);
  } catch (e) {
    res.status(500).send('Folder delete failed');
  }
});

// Quick share creation (JSON)
app.post('/admin/share/create', requireAdmin, async (req, res) => {
  const { folderKey, password, editable } = req.body;
  if (!folderKey) return res.status(400).json({ error: 'folderKey required' });
  try {
    const share = await createShareAsync({ folderKey, password, editable: !!editable });
    return res.json({ id: share.id, url: `/s/${share.id}` });
  } catch (e) {
    return res.status(500).json({ error: 'Failed to create share' });
  }
});

// On-demand presign for preview
app.get('/admin/sign', requireAdmin, async (req, res) => {
  const key = (req.query.key || '').toString();
  if (!key) return res.status(400).json({ error: 'key required' });
  try {
    const url = await signGetUrl(key, 3600);
    return res.json({ url });
  } catch (e) {
    return res.status(500).json({ error: 'Failed to sign' });
  }
});

// JSON API for GitHub Pages frontend
app.get('/api/share/:id', async (req, res) => {
  const share = getShareById(req.params.id);
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
  } catch (e) {
    res.status(500).json({ error: 'server_error' });
  }
});

// Thumbnail generator for items within a share
app.get('/s/:id/thumb', async (req, res) => {
  const share = getShareById(req.params.id);
  if (!share) return res.status(404).send('Share not found');
  if (share.passwordHash && !req.session[`share:${share.id}:ok`]) {
    return res.status(403).send('Password required');
  }
  const key = (req.query.key || '').toString();
  if (!key || !key.startsWith(share.folderKey.replace(/\/?$/, '/'))) {
    return res.status(400).send('Invalid key');
  }
  const width = Math.max(32, Math.min(1024, parseInt(req.query.w, 10) || 256));
  const height = Math.max(32, Math.min(1024, parseInt(req.query.h, 10) || width));
  try {
    const { bucket } = getEnvConfig();
    const s3Client = getS3();
    const cmd = new GetObjectCommand({ Bucket: bucket || (process.env.PROD_S3_BUCKET || process.env.S3_BUCKET), Key: key });
    const data = await s3Client.send(cmd);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.setHeader('Content-Type', 'image/jpeg');
    const transformer = sharp().rotate().resize({ width, height, fit: 'cover' }).jpeg({ quality: 70, mozjpeg: true });
    data.Body.pipe(transformer).pipe(res);
  } catch (e) {
    return res.status(500).send('Failed to create thumbnail');
  }
});

app.get('/s/:id/download.zip', async (req, res) => {
  const share = getShareById(req.params.id);
  if (!share) return res.status(404).send('Share not found');
  if (share.passwordHash && !req.session[`share:${share.id}:ok`]) {
    return res.status(403).send('Password required');
  }
  const folderKey = share.folderKey.replace(/\/?$/, '/');
  try {
    const objects = await listAllRecursive(folderKey);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(folderKey.split('/').filter(Boolean).pop() || 'folder')}.zip"`);
    req.setTimeout(0);
    res.setTimeout(0);
    const archive = archiver('zip', { zlib: { level: 6 } });
    archive.on('error', err => { try { res.status(500).end(); } catch(_){} });
    archive.pipe(res);
    const { bucket: bucketName } = getEnvConfig();
    const s3Client = getS3();
    for (const obj of objects) {
      const key = obj.Key;
      const rel = key.replace(folderKey, '');
      const cmd = new GetObjectCommand({ Bucket: bucketName || (process.env.PROD_S3_BUCKET || process.env.S3_BUCKET), Key: key });
      const data = await s3Client.send(cmd);
      archive.append(data.Body, { name: rel });
    }
    await archive.finalize();
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('ZIP error', e);
    return res.status(500).send('Failed to create zip');
  }
});

// Shares management
app.get('/admin/shares', requireAdmin, (req, res) => {
  res.render('admin/shares', { shares: listShares() });
});

app.post('/admin/shares', requireAdmin, (req, res) => {
  const { folderKey, password } = req.body;
  const share = createShare({ folderKey, password });
  res.redirect('/admin/shares');
});

app.post('/admin/shares/delete', requireAdmin, (req, res) => {
  const { id } = req.body;
  removeShare(id);
  res.redirect('/admin/shares');
});

// Public share route
app.get('/s/:id', async (req, res) => {
  const share = await getShareByIdAsync(req.params.id);
  if (!share) return res.status(404).send('Share not found');
  if (share.passwordHash && !req.session[`share:${share.id}:ok`]) {
    return res.render('public/enter-password', { id: share.id, error: null });
  }
  try {
    const { folders, files } = await listPrefix(share.folderKey);
    // For files, generate presigned GET urls
    const items = [];
    for (const f of files) {
      const url = await signGetUrl(f.key, 3600);
      items.push({ ...f, url });
    }
    res.render('public/gallery', { share, folders, items });
  } catch (e) {
    res.status(500).send('Error loading shared folder');
  }
});

app.post('/s/:id', async (req, res) => {
  const share = await getShareByIdAsync(req.params.id);
  if (!share) return res.status(404).send('Share not found');
  const { password } = req.body;
  if (verifySharePassword(share, password)) {
    req.session[`share:${share.id}:ok`] = true;
    return res.redirect(`/s/${share.id}`);
  }
  return res.status(401).render('public/enter-password', { id: share.id, error: 'Invalid password' });
});

// Public upload to editable share
app.post('/s/:id/upload', upload.array('photos'), async (req, res) => {
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
  } catch (e) {
    res.status(500).send('Upload failed');
  }
});

const port = process.env.PROD_PORT || process.env.PORT || 3000;
app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`Server listening on http://localhost:${port}`);
  // eslint-disable-next-line no-console
  console.log(`S3 config: bucket=${process.env.PROD_S3_BUCKET || process.env.S3_BUCKET || '(unset)'} endpoint=${process.env.PROD_S3_ENDPOINT || process.env.S3_ENDPOINT || `https://s3.${process.env.PROD_S3_REGION || process.env.S3_REGION || 'fr-par'}.scw.cloud`}`);
});


