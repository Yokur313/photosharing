import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mock } from 'node:test';
import { createTtlCache } from '../src/lib/ttlCache.js';

process.env.PROD_S3_BUCKET = 'test-photos';
process.env.PROD_SHARES_S3_BUCKET = 'test-shares';

const { getS3, listPrefixCached, putObject, deleteObject, isNotFoundError } = await import('../src/s3.js');
const { getShareByIdAsync, deleteShareAsync } = await import('../src/shareStore.js');

const noSuchKey = () => Object.assign(new Error('missing'), { name: 'NoSuchKey', $metadata: { httpStatusCode: 404 } });

let calls;
let shares;
let listings;
let failNextList;

before(() => {
  calls = [];
  shares = new Map();
  listings = new Map();
  failNextList = false;
  mock.method(getS3(), 'send', async (cmd) => {
    const name = cmd.constructor.name;
    const input = cmd.input;
    calls.push({ name, key: input.Key, prefix: input.Prefix });
    if (name === 'GetObjectCommand') {
      if (shares.has(input.Key)) return { Body: { transformToString: async () => JSON.stringify(shares.get(input.Key)) } };
      throw noSuchKey();
    }
    if (name === 'ListObjectsV2Command') {
      await new Promise((r) => setImmediate(r));
      if (failNextList) {
        failNextList = false;
        throw new Error('S3 stalled');
      }
      return { Contents: listings.get(input.Prefix) || [], IsTruncated: false };
    }
    return {};
  });
});

after(() => mock.restoreAll());

const count = (name, match = () => true) => calls.filter((c) => c.name === name && match(c)).length;

test('ttl cache returns values until they expire, and supports delete/clear', () => {
  let t = 1000;
  const cache = createTtlCache(100, () => t);
  cache.set('a', 1);
  cache.set('b', 2);
  assert.equal(cache.get('a'), 1);
  t += 99;
  assert.equal(cache.get('a'), 1);
  t += 1;
  assert.equal(cache.get('a'), undefined);
  assert.equal(cache.get('b'), undefined);
  cache.set('c', 3);
  cache.delete('c');
  assert.equal(cache.get('c'), undefined);
  cache.set('d', 4);
  cache.clear();
  assert.equal(cache.get('d'), undefined);
});

test('isNotFoundError matches S3 "missing key" errors only', () => {
  assert.equal(isNotFoundError(noSuchKey()), true);
  assert.equal(isNotFoundError({ name: 'NotFound' }), true);
  assert.equal(isNotFoundError({ $metadata: { httpStatusCode: 404 } }), true);
  assert.equal(isNotFoundError(new Error('socket hang up')), false);
  assert.equal(isNotFoundError({ $metadata: { httpStatusCode: 503 } }), false);
  assert.equal(isNotFoundError(null), false);
});

test('a found share is fetched from S3 once, then served from memory', async () => {
  const id = '11111111-1111-4111-8111-111111111111';
  shares.set(`__app_metadata__/shares/${id}.json`, { id, folderKey: 'trip/', passwordHash: null, editable: false });
  const before = count('GetObjectCommand', (c) => c.key.endsWith(`${id}.json`));
  const a = await getShareByIdAsync(id);
  const b = await getShareByIdAsync(id);
  assert.equal(a.folderKey, 'trip/');
  assert.deepEqual(b, a);
  assert.equal(count('GetObjectCommand', (c) => c.key.endsWith(`${id}.json`)) - before, 1);
});

test('callers cannot corrupt the cached share by mutating what they get back', async () => {
  const id = '22222222-2222-4222-8222-222222222222';
  shares.set(`__app_metadata__/shares/${id}.json`, { id, folderKey: 'safe/', passwordHash: null, editable: false });
  const first = await getShareByIdAsync(id);
  first.folderKey = 'hacked/';
  const second = await getShareByIdAsync(id);
  assert.equal(second.folderKey, 'safe/');
});

test('an unknown share is not cached, so a newly created share shows up immediately', async () => {
  const id = '33333333-3333-4333-8333-333333333333';
  const key = `__app_metadata__/shares/${id}.json`;
  assert.equal(await getShareByIdAsync(id), null);
  shares.set(key, { id, folderKey: 'new/', passwordHash: null, editable: false });
  const found = await getShareByIdAsync(id);
  assert.equal(found && found.folderKey, 'new/');
});

test('deleting a share drops it from the cache', async () => {
  const id = '44444444-4444-4444-8444-444444444444';
  const key = `__app_metadata__/shares/${id}.json`;
  shares.set(key, { id, folderKey: 'gone/', passwordHash: null, editable: false });
  assert.ok(await getShareByIdAsync(id));
  shares.delete(key);
  await deleteShareAsync(id);
  assert.equal(await getShareByIdAsync(id), null);
});

test('folder listings are cached, and concurrent requests share one S3 call', async () => {
  listings.set('list-a/', [{ Key: 'list-a/1.jpg', Size: 1 }]);
  const before = count('ListObjectsV2Command', (c) => c.prefix === 'list-a/');
  const [x, y] = await Promise.all([listPrefixCached('list-a/'), listPrefixCached('list-a/')]);
  const z = await listPrefixCached('/list-a/');
  assert.equal(x.files.length, 1);
  assert.equal(y, x);
  assert.equal(z, x);
  assert.equal(count('ListObjectsV2Command', (c) => c.prefix === 'list-a/') - before, 1);
});

test('a failed listing is not cached', async () => {
  listings.set('list-b/', [{ Key: 'list-b/1.jpg', Size: 1 }]);
  failNextList = true;
  await assert.rejects(listPrefixCached('list-b/'), /S3 stalled/);
  const ok = await listPrefixCached('list-b/');
  assert.equal(ok.files.length, 1);
});

test('uploading or deleting a photo clears cached listings', async () => {
  listings.set('list-c/', [{ Key: 'list-c/1.jpg', Size: 1 }]);
  const n = () => count('ListObjectsV2Command', (c) => c.prefix === 'list-c/');
  const start = n();
  await listPrefixCached('list-c/');
  await listPrefixCached('list-c/');
  assert.equal(n() - start, 1);
  await putObject('list-c/2.jpg', Buffer.from('x'), 'image/jpeg');
  await listPrefixCached('list-c/');
  assert.equal(n() - start, 2);
  await deleteObject('list-c/2.jpg');
  await listPrefixCached('list-c/');
  assert.equal(n() - start, 3);
});

test('writing a server-managed thumbnail does not clear cached listings', async () => {
  listings.set('list-d/', [{ Key: 'list-d/1.jpg', Size: 1 }]);
  const n = () => count('ListObjectsV2Command', (c) => c.prefix === 'list-d/');
  const start = n();
  await listPrefixCached('list-d/');
  await putObject('list-d/.thumbnails/abc.jpg', Buffer.from('x'), 'image/jpeg');
  await listPrefixCached('list-d/');
  assert.equal(n() - start, 1);
});
