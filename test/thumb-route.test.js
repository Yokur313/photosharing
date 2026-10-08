import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mock } from 'node:test';
import { Readable } from 'node:stream';
import sharp from 'sharp';

process.env.PROD_S3_BUCKET = 'test-photos';
process.env.PROD_SHARES_S3_BUCKET = 'test-shares';

const { getS3 } = await import('../src/s3.js');
const { createApp } = await import('../src/createApp.js');

const ID = '55555555-5555-4555-8555-555555555555';
const KEY = 'album/a.jpg';
const share = { id: ID, folderKey: 'album/', passwordHash: null, editable: false };
const noSuchKey = () => Object.assign(new Error('missing'), { name: 'NoSuchKey', $metadata: { httpStatusCode: 404 } });

let server;
let base;
let calls;
let cacheObject;
let png;

before(async () => {
  png = await sharp({ create: { width: 64, height: 48, channels: 3, background: '#336699' } }).png().toBuffer();
  calls = [];
  cacheObject = null;
  mock.method(getS3(), 'send', async (cmd) => {
    const name = cmd.constructor.name;
    const key = cmd.input.Key;
    calls.push({ name, key });
    if (name === 'GetObjectCommand' && key === `__app_metadata__/shares/${ID}.json`) {
      return { Body: { transformToString: async () => JSON.stringify(share) } };
    }
    if (name === 'GetObjectCommand' && key === KEY) {
      return { Body: { transformToByteArray: async () => new Uint8Array(png) } };
    }
    if (name === 'GetObjectCommand' && key.includes('/.thumbnails/')) {
      if (!cacheObject) throw noSuchKey();
      return { Body: Readable.from([cacheObject]) };
    }
    if (name === 'PutObjectCommand' && key.includes('/.thumbnails/')) {
      cacheObject = Buffer.from(cmd.input.Body);
      return {};
    }
    if (name === 'GetObjectCommand') throw noSuchKey();
    return {};
  });
  server = createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  mock.restoreAll();
  server.close();
});

const thumbUrl = () => `${base}/s/${ID}/thumb?key=${encodeURIComponent(KEY)}&w=480&fit=inside&maxh=3200`;

test('thumbnail cache miss generates a JPEG and stores it, without any HEAD request', async () => {
  const res = await fetch(thumbUrl());
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'image/jpeg');
  const meta = await sharp(Buffer.from(await res.arrayBuffer())).metadata();
  assert.equal(meta.format, 'jpeg');
  assert.ok(cacheObject, 'thumbnail was written to the cache');
  assert.equal(calls.filter((c) => c.name === 'HeadObjectCommand').length, 0);
});

test('thumbnail cache hit is served with a single S3 read and never touches the original', async () => {
  calls.length = 0;
  const res = await fetch(thumbUrl());
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'public, max-age=31536000');
  assert.deepEqual(Buffer.from(await res.arrayBuffer()), cacheObject);
  assert.equal(calls.filter((c) => c.name === 'HeadObjectCommand').length, 0);
  assert.equal(calls.filter((c) => c.key === KEY).length, 0);
  assert.equal(calls.filter((c) => c.key.includes('/.thumbnails/')).length, 1);
  // share lookup came from memory (it was cached by the first test)
  assert.equal(calls.filter((c) => c.key.startsWith('__app_metadata__/shares/')).length, 0);
});

test('a key outside the shared folder is rejected', async () => {
  const res = await fetch(`${base}/s/${ID}/thumb?key=${encodeURIComponent('other/secret.jpg')}&w=480`);
  assert.equal(res.status, 400);
});
