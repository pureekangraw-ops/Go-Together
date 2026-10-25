import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {assertCurrentRouting} from '../scripts/assert-current-routing.mjs';
const current = JSON.parse(readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));
test('release gate accepts current routes and blocks legacy reintroduction or wrong app target', () => {
  assert.equal(assertCurrentRouting(current), true);
  for (const service of ['phatheon-workhub', 'prytaneion-explorer', 'factory-district1']) {
    const bad = structuredClone(current);
    bad.services[0].service = service;
    assert.throws(() => assertCurrentRouting(bad));
  }
  const duplicate = structuredClone(current);
  duplicate.services.push(duplicate.services[0]);
  assert.throws(() => assertCurrentRouting(duplicate));
  const oldEntry = structuredClone(current);
  oldEntry.main = 'worker/index.js';
  assert.throws(() => assertCurrentRouting(oldEntry));
});
