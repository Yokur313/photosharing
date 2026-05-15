import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcryptjs';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
} from '@aws-sdk/client-s3';

const dataDir = path.join(process.cwd(), 'data');
const legacyFile = path.join(dataDir, 'shares.json');
const localSharesDir = path.join(dataDir, 'shares');

function useS3Storage() {
  return Boolean(process.env.PROD_SHARES_S3_BUCKET || process.env.SHARES_S3_BUCKET);
}

function sharesBucket() {
  return process.env.PROD_SHARES_S3_BUCKET || process.env.SHARES_S3_BUCKET;
}

function legacyS3Key() {
  return process.env.PROD_SHARES_S3_KEY || process.env.SHARES_S3_KEY || 'shares.json';
}

/** Prefix for per-share JSON objects (never use photo folder prefixes). */
function sharesObjectPrefix() {
  const p = process.env.PROD_SHARES_S3_PREFIX || process.env.SHARES_S3_PREFIX || '__app_metadata__/shares/';
  return p.endsWith('/') ? p : `${p}/`;
}

function shareObjectKey(id) {
  return `${sharesObjectPrefix()}${id}.json`;
}

function parseRecord(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (!raw.id || !raw.folderKey) return null;
  return raw;
}

function ensureLocalDir() {
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  if (!fs.existsSync(localSharesDir)) fs.mkdirSync(localSharesDir, { recursive: true });
}

function migrateLegacyLocalOnce() {
  if (!fs.existsSync(legacyFile)) return;
  const files = fs.existsSync(localSharesDir)
    ? fs.readdirSync(localSharesDir).filter((f) => f.endsWith('.json'))
    : [];
  if (files.length > 0) return;
  try {
    const data = JSON.parse(fs.readFileSync(legacyFile, 'utf-8'));
    const shares = Array.isArray(data.shares) ? data.shares : [];
    ensureLocalDir();
    for (const s of shares) {
      if (s && s.id) {
        fs.writeFileSync(path.join(localSharesDir, `${s.id}.json`), JSON.stringify(s, null, 2));
      }
    }
    fs.renameSync(legacyFile, `${legacyFile}.migrated`);
  } catch (_) {
    /* keep legacy file if migration fails */
  }
}

let legacyS3MigrationAttempted = false;

async function migrateLegacyS3Once() {
  if (legacyS3MigrationAttempted) return;
  legacyS3MigrationAttempted = true;
  const bucket = sharesBucket();
  if (!bucket) return;
  const { getS3 } = await import('./s3.js');
  const s3 = getS3();
  const legacyKey = legacyS3Key();
  try {
    const data = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: legacyKey }));
    const body = await data.Body.transformToString();
    const json = JSON.parse(body);
    const shares = Array.isArray(json.shares) ? json.shares : [];
    for (const s of shares) {
      if (s && s.id) {
        await s3.send(
          new PutObjectCommand({
            Bucket: bucket,
            Key: shareObjectKey(s.id),
            Body: JSON.stringify(s, null, 2),
            ContentType: 'application/json',
          })
        );
      }
    }
    await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: legacyKey }));
  } catch (_) {
    /* No legacy file or error — per-object mode still works */
  }
}

async function listShareKeysFromS3() {
  const bucket = sharesBucket();
  const { getS3 } = await import('./s3.js');
  const s3 = getS3();
  const prefix = sharesObjectPrefix();
  const keys = [];
  let ContinuationToken;
  do {
    const cmd = new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: prefix,
      ContinuationToken,
    });
    const out = await s3.send(cmd);
    (out.Contents || []).forEach((o) => {
      if (o.Key && o.Key.endsWith('.json') && o.Key !== legacyS3Key()) keys.push(o.Key);
    });
    ContinuationToken = out.IsTruncated ? out.NextContinuationToken : undefined;
  } while (ContinuationToken);
  return keys;
}

async function getShareFromS3ByKey(s3, bucket, key) {
  const data = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const body = await data.Body.transformToString();
  return parseRecord(JSON.parse(body));
}

export async function listSharesAsync() {
  if (useS3Storage()) {
    await migrateLegacyS3Once();
    const bucket = sharesBucket();
    const { getS3 } = await import('./s3.js');
    const s3 = getS3();
    const keys = await listShareKeysFromS3();
    const shares = [];
    for (const key of keys) {
      try {
        const rec = await getShareFromS3ByKey(s3, bucket, key);
        if (rec) shares.push(rec);
      } catch (_) {
        /* skip bad object */
      }
    }
    return shares;
  }
  migrateLegacyLocalOnce();
  ensureLocalDir();
  if (!fs.existsSync(localSharesDir)) return [];
  const names = fs.readdirSync(localSharesDir).filter((f) => f.endsWith('.json'));
  const shares = [];
  for (const name of names) {
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(localSharesDir, name), 'utf-8'));
      const rec = parseRecord(raw);
      if (rec) shares.push(rec);
    } catch (_) {
      /* skip */
    }
  }
  return shares;
}

export async function getShareByIdAsync(id) {
  if (!id) return null;
  if (useS3Storage()) {
    await migrateLegacyS3Once();
    const bucket = sharesBucket();
    const { getS3 } = await import('./s3.js');
    const s3 = getS3();
    const key = shareObjectKey(id);
    try {
      return await getShareFromS3ByKey(s3, bucket, key);
    } catch (_) {
      return null;
    }
  }
  migrateLegacyLocalOnce();
  ensureLocalDir();
  const f = path.join(localSharesDir, `${id}.json`);
  if (!fs.existsSync(f)) return null;
  try {
    return parseRecord(JSON.parse(fs.readFileSync(f, 'utf-8')));
  } catch (_) {
    return null;
  }
}

export async function createShareAsync({ folderKey, password, editable }) {
  const id = uuidv4();
  const record = {
    id,
    folderKey: folderKey.replace(/^\//, ''),
    passwordHash: password ? bcrypt.hashSync(password, 10) : null,
    editable: Boolean(editable),
    createdAt: new Date().toISOString(),
  };
  const body = JSON.stringify(record, null, 2);
  if (useS3Storage()) {
    await migrateLegacyS3Once();
    const bucket = sharesBucket();
    const { getS3 } = await import('./s3.js');
    const s3 = getS3();
    await s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: shareObjectKey(id),
        Body: body,
        ContentType: 'application/json',
      })
    );
    return record;
  }
  migrateLegacyLocalOnce();
  ensureLocalDir();
  fs.writeFileSync(path.join(localSharesDir, `${id}.json`), body);
  return record;
}

export async function deleteShareAsync(id) {
  if (!id) return;
  if (useS3Storage()) {
    await migrateLegacyS3Once();
    const bucket = sharesBucket();
    const { getS3 } = await import('./s3.js');
    const s3 = getS3();
    try {
      await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: shareObjectKey(id) }));
    } catch (_) {
      /* ignore */
    }
    return;
  }
  migrateLegacyLocalOnce();
  const f = path.join(localSharesDir, `${id}.json`);
  if (fs.existsSync(f)) fs.unlinkSync(f);
}

export function verifySharePassword(share, password) {
  if (!share.passwordHash) return true;
  return bcrypt.compareSync(password, share.passwordHash);
}

/** Normalize folder key for comparing share.folderKey with admin prefix (trailing slash). */
function normalizeShareFolder(fk) {
  let s = (fk || '').replace(/^\//, '');
  if (!s) return '';
  return s.endsWith('/') ? s : `${s}/`;
}

/** Most recently created share whose folder matches this prefix (exact folder, not subtree). */
export async function getLatestShareForFolderPrefix(prefix, sharesList = null) {
  const target = normalizeShareFolder(prefix);
  if (!target) return null;
  const shares = sharesList || (await listSharesAsync());
  const matches = shares.filter((s) => normalizeShareFolder(s.folderKey) === target);
  matches.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
  return matches[0] || null;
}

/** @deprecated Prefer async APIs; local disk only reads current layout */
export function listShares() {
  if (useS3Storage()) {
    throw new Error('listShares is not supported with SHARES_S3_BUCKET; use listSharesAsync');
  }
  migrateLegacyLocalOnce();
  ensureLocalDir();
  if (!fs.existsSync(localSharesDir)) return [];
  return fs
    .readdirSync(localSharesDir)
    .filter((f) => f.endsWith('.json'))
    .map((name) => parseRecord(JSON.parse(fs.readFileSync(path.join(localSharesDir, name), 'utf-8'))))
    .filter(Boolean);
}

export function getShareById(id) {
  if (useS3Storage()) return null;
  migrateLegacyLocalOnce();
  const f = path.join(localSharesDir, `${id}.json`);
  if (!fs.existsSync(f)) return null;
  try {
    return parseRecord(JSON.parse(fs.readFileSync(f, 'utf-8')));
  } catch (_) {
    return null;
  }
}

export function createShare({ folderKey, password, editable }) {
  if (useS3Storage()) {
    throw new Error('createShare is not supported with SHARES_S3_BUCKET; use createShareAsync');
  }
  const id = uuidv4();
  const record = {
    id,
    folderKey: folderKey.replace(/^\//, ''),
    passwordHash: password ? bcrypt.hashSync(password, 10) : null,
    editable: Boolean(editable),
    createdAt: new Date().toISOString(),
  };
  migrateLegacyLocalOnce();
  ensureLocalDir();
  fs.writeFileSync(path.join(localSharesDir, `${id}.json`), JSON.stringify(record, null, 2));
  return record;
}

export function deleteShare(id) {
  if (useS3Storage()) {
    throw new Error('deleteShare is not supported with SHARES_S3_BUCKET; use deleteShareAsync');
  }
  if (!id) return;
  migrateLegacyLocalOnce();
  const f = path.join(localSharesDir, `${id}.json`);
  if (fs.existsSync(f)) fs.unlinkSync(f);
}
