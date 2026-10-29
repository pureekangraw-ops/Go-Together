import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = path => readFile(new URL(path, import.meta.url), "utf8");

test("GO phone install manifest points to a standalone same-origin app", async () => {
  const manifest = JSON.parse(await read("../static/manifest.webmanifest"));
  assert.equal(manifest.start_url, "/");
  assert.equal(manifest.scope, "/");
  assert.equal(manifest.display, "standalone");
  assert.ok(manifest.icons.some(icon => icon.src === "/icon.svg" && icon.sizes === "any"));
});

test("PWA shell registers service worker and exposes mobile install guidance", async () => {
  const html = await read("../static/index.html");
  assert.match(html, /rel="manifest" href="\/manifest\.webmanifest"/);
  assert.match(html, /serviceWorker\.register\("\/service-worker\.js"/);
  assert.match(html, /beforeinstallprompt/);
  assert.match(html, /Add to Home Screen/);
  assert.match(html, /factory-approvals/);
});

test("service worker is network-only and never stores private responses", async () => {
  const worker = await read("../static/service-worker.js");
  assert.match(worker, /event\.respondWith\(fetch\(request\)\)/);
  assert.doesNotMatch(worker, /caches\.(open|match|put)|CacheStorage/);
  assert.match(worker, /url\.origin !== self\.location\.origin/);
});
