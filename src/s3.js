import { S3Client, ListObjectsV2Command, PutObjectCommand, DeleteObjectCommand, CopyObjectCommand, HeadObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

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
  const region = process.env.S3_REGION || 'fr-par';
  const bucket = process.env.S3_BUCKET;
  const rawEndpoint = process.env.S3_ENDPOINT || `https://s3.${region}.scw.cloud`;
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
        accessKeyId: process.env.S3_ACCESS_KEY_ID || '',
        secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || '',
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

export async function putObject(key, body, contentType) {
  const { bucket } = getEnvConfig();
  if (!bucket) throw new Error('S3_BUCKET not set');
  const s3 = getS3();
  const k = key.replace(/^\//, '');
  await s3.send(new PutObjectCommand({ Bucket: bucket, Key: k, Body: body, ContentType: contentType }));
}

export async function deleteObject(key) {
  const { bucket } = getEnvConfig();
  if (!bucket) throw new Error('S3_BUCKET not set');
  const s3 = getS3();
  const k = key.replace(/^\//, '');
  await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: k }));
}

export async function copyObject(fromKey, toKey) {
  const { bucket } = getEnvConfig();
  if (!bucket) throw new Error('S3_BUCKET not set');
  const s3 = getS3();
  const srcKey = fromKey.replace(/^\//, '');
  const dstKey = toKey.replace(/^\//, '');
  await s3.send(new CopyObjectCommand({ Bucket: bucket, CopySource: `/${bucket}/${srcKey}` , Key: dstKey }));
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


