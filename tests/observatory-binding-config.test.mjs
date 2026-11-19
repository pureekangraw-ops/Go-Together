import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const config = JSON.parse(readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8"));
const adapter = readFileSync(new URL("../worker/observatory-direct.mjs", import.meta.url), "utf8");

test("Observatory RPC binding keeps its named Worker entrypoint", () => {
  const bindings = (config.services || []).filter((binding) => binding.binding === "OBSERVATORY_GO");
  assert.equal(bindings.length, 1, "expected exactly one OBSERVATORY_GO service binding");
  assert.equal(bindings[0].service, "observatory-shared-browser");
  assert.equal(bindings[0].entrypoint, "ObservatoryGoBridge");
});

test("Observatory adapter uses the named RPC invoke contract", () => {
  assert.match(adapter, /env\?\.OBSERVATORY_GO/);
  assert.match(adapter, /OBSERVATORY_GO\.invoke\(name,args\)/);
});
