import test from 'node:test';
import assert from 'node:assert/strict';
import en from './landing.en.js';
import zu from './landing.zu.js';
import nso from './landing.nso.js';

// Same keys, same list lengths and no empty strings, so a missing translation can't leave a blank on the page.
const shape = value => Array.isArray(value) ? value.map(shape) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, shape(value[key])])) : typeof value;
const strings = value => typeof value === 'string' ? [value] : Object.values(value).flatMap(strings);

for (const [code, text] of Object.entries({ zu, nso })) {
  test(`landing.${code}.js has every English key`, () => {
    assert.deepEqual(shape(text), shape(en));
    assert.ok(strings(text).every(value => value.trim()));
  });
}
