// Same version-pinned supplier remediation as Hub scripts/patch-wrangler.cjs. See docs/go-manual-assets-deploy.md.
const { readFileSync, writeFileSync } = require("node:fs");
const { createHash } = require("node:crypto");
const { createRequire } = require("node:module");
const ORIGINAL_SHA =
  "f2d6a86faba5718912acbb5d3d2d3877095307a67f2c4503387e3b5e417fa150";
const START = "// ../../node_modules/.pnpm/undici@7.29.1/";
const END = "// ../workers-utils/src/cfetch/errors.ts";
const ADAPTER = `// HUBSTATION_UNDICI_ADAPTER_BEGIN\nvar require_undici = __commonJS({\n  "hubstation/undici-7.30.1"(exports2, module2) {\n    module2.exports = require("undici");\n  }\n});\n// HUBSTATION_UNDICI_ADAPTER_END\n\n`;
const hash = (s) => createHash("sha256").update(s).digest("hex");
// Generated from the exact published Wrangler4.152.0 source and the adapter above.
const PATCHED_SHA =
  "930f405621497d3da1bf8c9e3ce1463214094e64042884c3ad6f43bb433fb6c8";
function patchBundledUndici(source) {
  const sha = hash(source);
  if (sha === PATCHED_SHA) {
    adapterFrom(source);
    return source;
  }
  if (sha !== ORIGINAL_SHA)
    throw new Error(
      "VENDOR_SOURCE_MISMATCH: review a new Wrangler artifact before patching",
    );
  const start = source.indexOf(START),
    end = source.indexOf(END, start);
  if (start < 0 || end <= start) throw new Error("VENDOR_LAYOUT_MISMATCH");
  const removed = source.slice(start, end),
    outside = source.slice(0, start) + source.slice(end);
  const declarations = [
    ...removed.matchAll(/var (require_\w+) = __commonJS\(/g),
  ].map((m) => m[1]);
  const references = new Set(outside.match(/\brequire_\w+\b/g) || []);
  if (
    !declarations.includes("require_undici") ||
    declarations.some((n) => n !== "require_undici" && references.has(n))
  )
    throw new Error(
      "VENDOR_EXTERNAL_REFERENCE: a removed helper still has callers",
    );
  const patched = source.slice(0, start) + ADAPTER + source.slice(end);
  if (hash(patched) !== PATCHED_SHA) throw new Error("PATCH_OUTPUT_MISMATCH");
  return patched;
}
function adapterFrom(source) {
  if (hash(source) !== PATCHED_SHA) throw new Error("VENDOR_SOURCE_MISMATCH");
  const start = source.indexOf("// HUBSTATION_UNDICI_ADAPTER_BEGIN"),
    end = source.indexOf("// HUBSTATION_UNDICI_ADAPTER_END", start);
  if (start < 0 || end < 0) throw new Error("VENDOR_ADAPTER_MISSING");
  return source.slice(start, end);
}
function run(verifyOnly = false) {
  const cli = require.resolve("wrangler");
  const vendorRequire = createRequire(cli);
  if (vendorRequire("./../package.json").version !== "4.152.0")
    throw new Error("WRANGLER_VERSION_MISMATCH");
  if (vendorRequire("undici/package.json").version !== "7.30.1")
    throw new Error("UNDICI_VERSION_MISMATCH");
  const source = readFileSync(cli, "utf8");
  if (verifyOnly) {
    adapterFrom(source);
    console.log("Wrangler supplier remediation verified");
    return;
  }
  const patched = patchBundledUndici(source);
  if (patched !== source) writeFileSync(cli, patched);
  console.log("Wrangler supplier remediation applied and verified");
}
module.exports = { patchBundledUndici, adapterFrom };
if (require.main === module) run(process.argv.includes("--verify"));
