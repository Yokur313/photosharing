import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/createApp.js';

test('createApp builds an Express application', () => {
  const app = createApp();
  assert.ok(app);
  assert.equal(typeof app.handle, 'function');
});
