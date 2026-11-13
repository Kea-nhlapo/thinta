import test from 'node:test';
import assert from 'node:assert/strict';
import { brailleDots, cellDots, toBraille } from './braille.js';

test('coordinates: parentheses, number sign, comma and minus', () => {
  assert.equal(toBraille('(1,-9)'), '⠐⠣⠼⠁⠂⠐⠤⠼⠊⠐⠜');
  assert.equal(toBraille('(4,0)'), '⠐⠣⠼⠙⠂⠼⠚⠐⠜');
});

test('digits, decimals, letters and capitals', () => {
  assert.equal(toBraille('120'), '⠼⠁⠃⠚');
  assert.equal(toBraille('2.5'), '⠼⠃⠲⠑');
  assert.equal(toBraille('Jan'), '⠠⠚⠁⠝');
  assert.equal(toBraille('2a'), '⠼⠃⠰⠁'); // a straight after a number needs the grade 1 indicator
  assert.equal(toBraille('2x'), '⠼⠃⠭');
  assert.equal(toBraille('well-known'), '⠺⠑⠇⠇⠤⠅⠝⠕⠺⠝');
});

test('cell dots and positions follow the standard cell', () => {
  assert.deepEqual(cellDots('⠼'), [3, 4, 5, 6]);
  const dots = brailleDots('⠁⠁', 0, 0);
  assert.deepEqual(dots.map(d => d.x), [0.75, 6.75]);
});
