import { test } from 'node:test';
import assert from 'node:assert/strict';
import { v4 as uuidv4 } from 'uuid';
import { encodeShareId, decodeShareId } from '../src/lib/shortId.js';
import { folderTitle, publicBaseUrl } from '../src/lib/shareCard.js';

test('short id round-trips for real share ids and is 22 chars', () => {
  for (let i = 0; i < 200; i++) {
    const id = uuidv4();
    const code = encodeShareId(id);
    assert.equal(code.length, 22);
    assert.match(code, /^[A-Za-z0-9_-]{22}$/);
    assert.equal(decodeShareId(code), id);
  }
});

test('the live share id from the bug report round-trips', () => {
  const id = 'ad61a20e-6c3a-49f5-a4fc-596f7ff67351';
  assert.equal(decodeShareId(encodeShareId(id)), id);
});

test('decode rejects malformed or non-canonical codes', () => {
  assert.equal(decodeShareId('short'), null);
  assert.equal(decodeShareId('x'.repeat(23)), null);
  assert.equal(decodeShareId('!'.repeat(22)), null);
  const code = encodeShareId(uuidv4());
  // the last char carries 2 data bits + 4 padding bits; setting a padding bit is a non-canonical alias
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  const alias = code.slice(0, 21) + alphabet[alphabet.indexOf(code[21]) + 1];
  assert.equal(decodeShareId(alias), null);
  assert.equal(encodeShareId('not-a-uuid'), null);
});

test('folderTitle uses the last path segment and trims stray spaces', () => {
  assert.equal(folderTitle('BALL hikes August 2026 /'), 'BALL hikes August 2026');
  assert.equal(folderTitle('trips/2026/Iceland/'), 'Iceland');
  assert.equal(folderTitle('313/'), '313');
  assert.equal(folderTitle(''), 'Shared photos');
});

test('publicBaseUrl prefers PUBLIC_BASE_URL, then forwarded proto + host', () => {
  const req = { protocol: 'http', get: (h) => ({ host: 'photos.example.com', 'x-forwarded-proto': 'https' })[h.toLowerCase()] };
  const saved = process.env.PUBLIC_BASE_URL;
  delete process.env.PUBLIC_BASE_URL;
  assert.equal(publicBaseUrl(req), 'https://photos.example.com');
  process.env.PUBLIC_BASE_URL = 'https://p.example.org/';
  assert.equal(publicBaseUrl(req), 'https://p.example.org');
  if (saved === undefined) delete process.env.PUBLIC_BASE_URL;
  else process.env.PUBLIC_BASE_URL = saved;
});
