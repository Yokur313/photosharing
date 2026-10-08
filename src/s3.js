import { S3Client, ListObjectsV2Command, PutObjectCommand, DeleteObjectCommand, CopyObjectCommand, HeadObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createTtlCache } from './lib/ttlCache.js';

function normalizeEndpoint(ep, b) {
  if (!ep || !b) return ep;
  try {
    const u = new URL(ep);
    const host = u.hostname; // e.g. photo-storage-313.s3.fr-par.scw.cloud or s3.fr-par.scw.cloud
    const bucketPrefix = `${b}.`;
    if (host.startsWith(bucketPrefix)) {
      u.hostname = host.slice(bucketPrefix.length);
      return u.toString();
    }
    return ep;
  } catch (_) {
    return ep;
  }
}

export function getEnvConfig() {
  const region = process.env.PROD_S3_REGION || process.env.S3_REGION || 'fr-par';
  const bucket = process.env.PROD_S3_BUCKET || process.env.S3_BUCKET;
  const rawEndpoint = process.env.PROD_S3_ENDPOINT || process.env.S3_ENDPOINT || `https://s3.${region}.scw.cloud`;
  const endpoint = normalizeEndpoint(rawEndpoint, bucket);
  return { region, bucket, endpoint };
}

let s3Client = null;
export function getS3() {
  if (!s3Client) {
    const { region, endpoint } = getEnvConfig();
    s3Client = new S3Client({
      region,
      endpoint,
      forcePathStyle: false,
      credentials: {
        accessKeyId: process.env.PROD_S3_ACCESS_KEY_ID || process.env.S3_ACCESS_KEY_ID || '',
        secretAccessKey: process.env.PROD_S3_SECRET_ACCESS_KEY || process.env.S3_SECRET_ACCESS_KEY || '',
      },
    });
  }
  return s3Client;
}

export async function listPrefix(prefix = '') {
  const { bucket } = getEnvConfig();
  if (!bucket) throw new Error('S3_BUCKET not set');
  const s3 = getS3();
  const sanitized = prefix === '/' ? '' : prefix.replace(/^\//, '');
  const folders = [];
  const files = [];
  let ContinuationToken = undefined;
  do {
    const cmd = new ListObjectsV2Command({ Bucket: bucket, Prefix: sanitized, Delimiter: '/', ContinuationToken });
    const data = await s3.send(cmd);
    (data.CommonPrefixes || []).forEach(p => folders.push(p.Prefix));
    (data.Contents || [])
      .filter(o => o.Key !== sanitized)
      .forEach(o => files.push({ key: o.Key, size: o.Size, lastModified: o.LastModified }));
    ContinuationToken = data.IsTruncated ? data.NextContinuationToken : undefined;
  } while (ContinuationToken);
  return { folders, files };
}

// Short-lived cache of folder listings for the public gallery (the S3 LIST is the slow part of every page).
// Any write through the helpers below clears it, except server-managed thumbnail cache objects, which never
// appear in a folder's direct listing. Other instances may serve a stale listing for up to LISTING_TTL_MS.
const LISTING_TTL_MS = 30 * 1000;
const listingCache = createTtlCache(LISTING_TTL_MS);

export function listPrefixCached(prefix = '') {
  const cacheKey = prefix === '/' ? '' : prefix.replace(/^\//, '');
  const hit = listingCache.get(cacheKey);
  if (hit) return hit;
  const pending = listPrefix(prefix);
  listingCache.set(cacheKey, pending);
  pending.catch(() => {
    if (listingCache.get(cacheKey) === pending) listingCache.delete(cacheKey);
  });
  return pending;
}

export function isNotFoundError(e) {
  return Boolean(e && (e.name === 'NoSuchKey' || e.name === 'NotFound' || (e.$metadata && e.$metadata.httpStatusCode === 404)));
}

export async function putObject(key, body, contentType) {
  const { bucket } = getEnvConfig();
  if (!bucket) throw new Error('S3_BUCKET not set');
  const s3 = getS3();
  const k = key.replace(/^\//, '');
  await s3.send(new PutObjectCommand({ Bucket: bucket, Key: k, Body: body, ContentType: contentType }));
  if (!isThumbnailCacheKey(k)) listingCache.clear();
}

export async function deleteObject(key) {
  const { bucket } = getEnvConfig();
  if (!bucket) throw new Error('S3_BUCKET not set');
  const s3 = getS3();
  const k = key.replace(/^\//, '');
  await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: k }));
  if (!isThumbnailCacheKey(k)) listingCache.clear();
}

export async function copyObject(fromKey, toKey) {
  const { bucket } = getEnvConfig();
  if (!bucket) throw new Error('S3_BUCKET not set');
  const s3 = getS3();
  const srcKey = fromKey.replace(/^\//, '');
  const dstKey = toKey.replace(/^\//, '');
  await s3.send(new CopyObjectCommand({ Bucket: bucket, CopySource: `/${bucket}/${srcKey}` , Key: dstKey }));
  if (!isThumbnailCacheKey(dstKey)) listingCache.clear();
}

export async function objectExists(key) {
  try {
    const { bucket } = getEnvConfig();
    if (!bucket) throw new Error('S3_BUCKET not set');
    const s3 = getS3();
    await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key.replace(/^\//, '') }));
    return true;
  } catch (e) {
    return false;
  }
}

export async function signGetUrl(key, expiresInSeconds = 3600) {
  const { bucket } = getEnvConfig();
  if (!bucket) throw new Error('S3_BUCKET not set');
  const s3 = getS3();
  const getCmd = new GetObjectCommand({ Bucket: bucket, Key: key.replace(/^\//, '') });
  return await getSignedUrl(s3, getCmd, { expiresIn: expiresInSeconds });
}

export function joinKey(...parts) {
  const joined = parts.join('/').replace(/\\/g, '/');
  return joined.replace(/^\/+/, '').replace(/\/+/g, '/');
}

/** True if key is under a `.thumbnails` cache directory (server-managed; hide from listings and zips). */
export function isThumbnailCacheKey(key) {
  if (!key || typeof key !== 'string') return false;
  const k = key.replace(/^\//, '');
  return k.includes('/.thumbnails/') || k === '.thumbnails' || k.startsWith('.thumbnails/');
}

export async function createFolder(prefix) {
  const key = joinKey(prefix).replace(/\/?$/, '/')
  // S3-style folders are zero-byte objects ending with '/'
  await putObject(key, Buffer.alloc(0), 'application/x-directory');
}

export async function deleteFolderRecursive(prefix) {
  const { files, folders } = await listPrefix(prefix);
  for (const f of files) {
    await deleteObject(f.key);
  }
  for (const sub of folders) {
    await deleteFolderRecursive(sub);
  }
  // delete the folder marker if exists
  if (await objectExists(joinKey(prefix).replace(/\/?$/, '/'))) {
    await deleteObject(joinKey(prefix).replace(/\/?$/, '/'));
  }
}

export async function listAllRecursive(prefix = '') {
  const { bucket } = getEnvConfig();
  if (!bucket) throw new Error('S3_BUCKET not set');
  const s3 = getS3();
  const sanitized = prefix === '/' ? '' : prefix.replace(/^\//, '');
  const objects = [];
  let ContinuationToken = undefined;
  do {
    const cmd = new ListObjectsV2Command({ Bucket: bucket, Prefix: sanitized, ContinuationToken });
    const data = await s3.send(cmd);
    (data.Contents || []).forEach(o => { if (o.Key && !o.Key.endsWith('/')) objects.push(o); });
    ContinuationToken = data.IsTruncated ? data.NextContinuationToken : undefined;
  } while (ContinuationToken);
  return objects;
}


