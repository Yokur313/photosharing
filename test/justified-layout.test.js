import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planRow, targetRowHeight } from '../public/justified-layout.js';

const W = 1000;
const H = 240;
const GAP = 8;

function groupAll(ratios, final = true) {
  const rows = [];
  let start = 0;
  let plan;
  while ((plan = planRow(ratios, start, W, H, GAP, final))) {
    rows.push({ start, ...plan });
    start += plan.n;
  }
  return { rows, consumed: start };
}

test('rows take photos strictly in order with no gaps or overlaps', () => {
  const ratios = [1.5, 0.67, 1.5, 1.78, 0.67, 0.67, 1.0, 1.5, 3.2, 0.75, 1.5, 1.5, 0.67];
  const { rows, consumed } = groupAll(ratios);
  assert.equal(consumed, ratios.length);
  let expectedStart = 0;
  for (const row of rows) {
    assert.equal(row.start, expectedStart);
    expectedStart += row.n;
  }
});

test('stretched rows are close to the target height', () => {
  const ratios = Array(30).fill(1.5);
  const { rows } = groupAll(ratios);
  for (const row of rows.filter((r) => r.stretch)) {
    const sum = ratios.slice(row.start, row.start + row.n).reduce((a, b) => a + b, 0);
    const h = (W - GAP * (row.n - 1)) / sum;
    assert.ok(Math.abs(h - H) < H * 0.5, `row height ${h} too far from ${H}`);
  }
});

test('waits while a ratio in the row is still unknown', () => {
  assert.equal(planRow([1.5, null, 1.5, 1.5], 0, W, H, GAP, false), null);
  assert.equal(planRow([1.5, null, 1.5, 1.5], 0, W, H, GAP, true), null);
});

test('an unknown ratio after a full row does not block that row', () => {
  const plan = planRow([1.5, 1.5, 1.5, 1.5, null], 0, W, H, GAP, false);
  assert.ok(plan && plan.stretch && plan.n >= 2);
});

test('a short last row is only emitted when final, and is not stretched', () => {
  assert.equal(planRow([1.5, 1.5], 0, W, H, GAP, false), null);
  assert.deepEqual(planRow([1.5, 1.5], 0, W, H, GAP, true), { n: 2, stretch: false });
});

test('a very wide photo gets a row of its own', () => {
  const plan = planRow([6, 1.5, 1.5], 0, W, H, GAP, false);
  assert.deepEqual(plan, { n: 1, stretch: true });
});

test('target row height shrinks on narrow screens', () => {
  assert.ok(targetRowHeight(360) < targetRowHeight(700));
  assert.ok(targetRowHeight(700) < targetRowHeight(1200));
});
