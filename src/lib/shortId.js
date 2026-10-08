import { validate as uuidValidate } from 'uuid';

// A share's UUID re-encoded as 22 base64url characters. Same 128 bits, so it is no easier to guess,
// and it round-trips to the exact original id, so nothing has to be stored or migrated.
export function encodeShareId(id) {
  if (typeof id !== 'string' || !uuidValidate(id)) return null;
  return Buffer.from(id.replace(/-/g, ''), 'hex').toString('base64url');
}

export function decodeShareId(code) {
  if (typeof code !== 'string' || !/^[A-Za-z0-9_-]{22}$/.test(code)) return null;
  const buf = Buffer.from(code, 'base64url');
  if (buf.length !== 16) return null;
  const h = buf.toString('hex');
  const id = `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  return encodeShareId(id) === code ? id : null;
}
