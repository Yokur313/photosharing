import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcryptjs';

const dataDir = path.join(process.cwd(), 'data');
const dataFile = path.join(dataDir, 'shares.json');

function ensureFile() {
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  if (!fs.existsSync(dataFile)) fs.writeFileSync(dataFile, JSON.stringify({ shares: [] }, null, 2));
}

export function listShares() {
  ensureFile();
  const data = JSON.parse(fs.readFileSync(dataFile, 'utf-8'));
  return data.shares;
}

export function getShareById(id) {
  return listShares().find(s => s.id === id) || null;
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

export function deleteShare(id) {
  ensureFile();
  const shares = listShares();
  const updated = { shares: shares.filter(s => s.id !== id) };
  fs.writeFileSync(dataFile, JSON.stringify(updated, null, 2));
}

export function verifySharePassword(share, password) {
  if (!share.passwordHash) return true;
  return bcrypt.compareSync(password, share.passwordHash);
}


