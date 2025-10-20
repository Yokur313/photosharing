import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcryptjs';

const dataDir = path.join(process.cwd(), 'data');
const dataFile = path.join(dataDir, 'shares.json');

function useS3Storage() {
  return Boolean(process.env.PROD_SHARES_S3_BUCKET || process.env.SHARES_S3_BUCKET);
}

async function readFromS3() {
  const { getS3, getEnvConfig } = await import('./s3.js');
  const s3 = getS3();
  const bucket = process.env.PROD_SHARES_S3_BUCKET || process.env.SHARES_S3_BUCKET;
  const key = process.env.PROD_SHARES_S3_KEY || process.env.SHARES_S3_KEY || 'shares.json';
  try {
    const { GetObjectCommand } = await import('@aws-sdk/client-s3');
    const data = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const body = await data.Body.transformToString();
    return JSON.parse(body);
  } catch (_) {
    return { shares: [] };
  }
}

async function writeToS3(json) {
  const { getS3 } = await import('./s3.js');
  const s3 = getS3();
  const bucket = process.env.PROD_SHARES_S3_BUCKET || process.env.SHARES_S3_BUCKET;
  const key = process.env.PROD_SHARES_S3_KEY || process.env.SHARES_S3_KEY || 'shares.json';
  const { PutObjectCommand } = await import('@aws-sdk/client-s3');
  await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: JSON.stringify(json, null, 2), ContentType: 'application/json' }));
}

function ensureFile() {
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  if (!fs.existsSync(dataFile)) fs.writeFileSync(dataFile, JSON.stringify({ shares: [] }, null, 2));
}

export function listShares() {
  ensureFile();
  const data = JSON.parse(fs.readFileSync(dataFile, 'utf-8'));
  return data.shares;
}

export async function listSharesAsync() {
  if (useS3Storage()) return (await readFromS3()).shares;
  ensureFile();
  const data = JSON.parse(fs.readFileSync(dataFile, 'utf-8'));
  return data.shares;
}

export function getShareById(id) {
  return listShares().find(s => s.id === id) || null;
}

export async function getShareByIdAsync(id) {
  const shares = await listSharesAsync();
  return shares.find(s => s.id === id) || null;
}

export function createShare({ folderKey, password, editable }) {
  ensureFile();
  const shares = listShares();
  const id = uuidv4();
  const record = {
    id,
    folderKey: folderKey.replace(/^\//, ''),
    passwordHash: password ? bcrypt.hashSync(password, 10) : null,
    editable: Boolean(editable),
    createdAt: new Date().toISOString(),
  };
  const updated = { shares: [...shares, record] };
  fs.writeFileSync(dataFile, JSON.stringify(updated, null, 2));
  return record;
}

export async function createShareAsync({ folderKey, password, editable }) {
  const shares = await listSharesAsync();
  const id = uuidv4();
  const record = {
    id,
    folderKey: folderKey.replace(/^\//, ''),
    passwordHash: password ? bcrypt.hashSync(password, 10) : null,
    editable: Boolean(editable),
    createdAt: new Date().toISOString(),
  };
  const updated = { shares: [...shares, record] };
  if (useS3Storage()) await writeToS3(updated); else ensureFile(), fs.writeFileSync(dataFile, JSON.stringify(updated, null, 2));
  return record;
}

export function deleteShare(id) {
  ensureFile();
  const shares = listShares();
  const updated = { shares: shares.filter(s => s.id !== id) };
  fs.writeFileSync(dataFile, JSON.stringify(updated, null, 2));
}

export async function deleteShareAsync(id) {
  const shares = await listSharesAsync();
  const updated = { shares: shares.filter(s => s.id !== id) };
  if (useS3Storage()) await writeToS3(updated); else ensureFile(), fs.writeFileSync(dataFile, JSON.stringify(updated, null, 2));
}

export function verifySharePassword(share, password) {
  if (!share.passwordHash) return true;
  return bcrypt.compareSync(password, share.passwordHash);
}


