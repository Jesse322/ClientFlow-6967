import fs from "node:fs/promises";
import { readFileSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(scriptDir, "..");

// ─── 1. Clean orphaned client assets ─────────────────────────────────────────

const clientDir = path.join(webRoot, "dist", "client");
const assetsDir = path.join(clientDir, "assets");
const indexHtmlPath = path.join(clientDir, "index.html");
const deletableExtensions = new Set([".css", ".js"]);

async function exists(filePath) {
  try { await fs.access(filePath); return true; } catch { return false; }
}

function stripQueryAndHash(ref) { return ref.split(/[?#]/, 1)[0]; }

function assetNameFromRef(ref) {
  const cleanRef = stripQueryAndHash(ref.trim());
  if (cleanRef.startsWith("/assets/")) return cleanRef.slice("/assets/".length);
  if (cleanRef.startsWith("assets/")) return cleanRef.slice("assets/".length);
  if (cleanRef.startsWith("./")) return cleanRef.slice("./".length);
  return cleanRef;
}

function collectAssetRefs(content) {
  const refs = new Set();
  const patterns = [
    /["'`](\/?assets\/[^"'`<>()\s]+?\.(?:css|js)(?:[?#][^"'`<>()\s]*)?)["'`]/g,
    /["'`](\.\/[^"'`<>()\s]+?\.(?:css|js)(?:[?#][^"'`<>()\s]*)?)["'`]/g,
  ];
  for (const pattern of patterns) {
    for (const match of content.matchAll(pattern)) refs.add(assetNameFromRef(match[1]));
  }
  return refs;
}

async function collectReachableAssets() {
  const reachable = new Set();
  const queue = [];
  const html = await fs.readFile(indexHtmlPath, "utf8");
  for (const ref of collectAssetRefs(html)) { reachable.add(ref); queue.push(ref); }
  while (queue.length > 0) {
    const assetName = queue.pop();
    const assetPath = path.join(assetsDir, assetName);
    if (!deletableExtensions.has(path.extname(assetName))) continue;
    if (!(await exists(assetPath))) continue;
    const content = await fs.readFile(assetPath, "utf8");
    for (const ref of collectAssetRefs(content)) {
      if (reachable.has(ref)) continue;
      if (!(await exists(path.join(assetsDir, ref)))) continue;
      reachable.add(ref); queue.push(ref);
    }
  }
  return reachable;
}

async function cleanOrphanedAssets() {
  if (!(await exists(assetsDir)) || !(await exists(indexHtmlPath))) return;
  const reachable = await collectReachableAssets();
  const assetNames = await fs.readdir(assetsDir);
  let deletedCount = 0, deletedBytes = 0;
  for (const assetName of assetNames) {
    if (!deletableExtensions.has(path.extname(assetName))) continue;
    if (reachable.has(assetName)) continue;
    const assetPath = path.join(assetsDir, assetName);
    const stats = await fs.stat(assetPath);
    await fs.unlink(assetPath);
    deletedCount += 1;
    deletedBytes += stats.size;
  }
  if (deletedCount > 0) {
    console.log(`✓ Removed ${deletedCount} orphaned client assets (${Math.round(deletedBytes / 1024)} KiB freed)`);
  }
}

await cleanOrphanedAssets();

// ─── 2. Clean dist/sandbox_website_template/wrangler.json ────────────────────
// The CF Vite plugin dumps internal fields (topLevelName, legacy_env, flagship,
// cloudchamber, etc.) that cause "Failed to place sandbox" on Runable's deploy system.

const wranglerPath = path.join(webRoot, "dist", "sandbox_website_template", "wrangler.json");
try {
  const config = JSON.parse(readFileSync(wranglerPath, "utf8"));
  const clean = {
    name: config.name,
    main: config.main,
    compatibility_date: config.compatibility_date,
    compatibility_flags: config.compatibility_flags,
    assets: config.assets,
    vars: config.vars,
    ...(config.triggers?.crons?.length ? { triggers: config.triggers } : {}),
    ...(config.durable_objects?.bindings?.length ? { durable_objects: config.durable_objects } : {}),
    ...(config.kv_namespaces?.length ? { kv_namespaces: config.kv_namespaces } : {}),
    ...(config.r2_buckets?.length ? { r2_buckets: config.r2_buckets } : {}),
    ...(config.d1_databases?.length ? { d1_databases: config.d1_databases } : {}),
    ...(config.queues?.producers?.length || config.queues?.consumers?.length ? { queues: config.queues } : {}),
    // no_bundle intentionally omitted — wrangler must re-bundle to resolve bare Node
    // builtins (stream, path, crypto, etc.) via nodejs_compat. no_bundle:true passes
    // chunks as-is to V8 which can't resolve them → "Load failed".
  };
  writeFileSync(wranglerPath, JSON.stringify(clean, null, 2));
  console.log("✓ Cleaned dist/sandbox_website_template/wrangler.json");
} catch (e) {
  console.warn("⚠ Could not patch wrangler.json:", e.message);
}

// ─── 3. Rewrite bare Node builtins to node: prefix in worker chunks ──────────
// CF Workers with nodejs_compat supports both "node:x" and bare "x" specifiers,
// BUT only when wrangler bundles the code itself. When the platform deploys
// pre-built chunks directly, bare specifiers reach V8 unresolved → "Load failed".
// Rewriting them to "node:" prefix ensures they resolve regardless of bundling.

const NODE_BUILTINS = new Set([
  "assert", "async_hooks", "buffer", "child_process", "cluster", "console",
  "constants", "crypto", "dgram", "diagnostics_channel", "dns", "domain",
  "events", "fs", "fs/promises", "http", "http2", "https", "inspector",
  "module", "net", "os", "path", "path/posix", "path/win32", "perf_hooks",
  "process", "punycode", "querystring", "readline", "repl", "stream",
  "stream/consumers", "stream/promises", "stream/web", "string_decoder",
  "sys", "timers", "timers/promises", "tls", "trace_events", "tty", "url",
  "util", "util/types", "v8", "vm", "wasi", "worker_threads", "zlib",
]);

function rewriteNodeImports(src) {
  // Match both: import "x" and from "x" (side-effect and named imports)
  return src.replace(/(?:from |import )["']([a-z][a-z0-9_/.-]*)["']/g, (match, spec) => {
    if (spec.startsWith("node:")) return match;
    if (NODE_BUILTINS.has(spec)) {
      return match.replace(`"${spec}"`, `"node:${spec}"`).replace(`'${spec}'`, `'node:${spec}'`);
    }
    return match;
  });
}

const workerDir = path.join(webRoot, "dist", "sandbox_website_template");
const workerAssets = path.join(workerDir, "assets");
const workerFiles = [
  path.join(workerDir, "index.js"),
  ...(await exists(workerAssets)
    ? (await fs.readdir(workerAssets)).map(f => path.join(workerAssets, f)).filter(f => f.endsWith(".js"))
    : []),
];

let patchedFiles = 0;
for (const file of workerFiles) {
  const original = readFileSync(file, "utf8");
  const patched = rewriteNodeImports(original);
  if (patched !== original) {
    writeFileSync(file, patched);
    patchedFiles++;
  }
}
console.log(`✓ Rewrote bare Node builtins to node: prefix in ${patchedFiles} worker file(s)`);

// ─── 4. Remove .wrangler/deploy/config.json ──────────────────────────────────
// The CF Vite plugin creates this to redirect wrangler to the pre-bundled
// dist/sandbox_website_template/ which has no_bundle:true and bare Node specifiers.
// Deleting it forces wrangler to use our cleaned wrangler.json and re-bundle properly.

const deployConfig = path.join(webRoot, ".wrangler", "deploy", "config.json");
try {
  rmSync(deployConfig);
  console.log("✓ Removed .wrangler/deploy/config.json");
} catch (_) { /* may not exist */ }
