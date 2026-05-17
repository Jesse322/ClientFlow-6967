import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(scriptDir, "..");
const clientDir = path.join(webRoot, "dist", "client");
const assetsDir = path.join(clientDir, "assets");
const indexHtmlPath = path.join(clientDir, "index.html");
const deletableExtensions = new Set([".css", ".js"]);

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function stripQueryAndHash(ref) {
  return ref.split(/[?#]/, 1)[0];
}

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
    for (const match of content.matchAll(pattern)) {
      refs.add(assetNameFromRef(match[1]));
    }
  }

  return refs;
}

async function collectReachableAssets() {
  const reachable = new Set();
  const queue = [];

  const html = await fs.readFile(indexHtmlPath, "utf8");
  for (const ref of collectAssetRefs(html)) {
    reachable.add(ref);
    queue.push(ref);
  }

  while (queue.length > 0) {
    const assetName = queue.pop();
    const assetPath = path.join(assetsDir, assetName);

    if (!deletableExtensions.has(path.extname(assetName))) continue;
    if (!(await exists(assetPath))) continue;

    const content = await fs.readFile(assetPath, "utf8");
    for (const ref of collectAssetRefs(content)) {
      if (reachable.has(ref)) continue;
      if (!(await exists(path.join(assetsDir, ref)))) continue;

      reachable.add(ref);
      queue.push(ref);
    }
  }

  return reachable;
}

async function cleanOrphanedAssets() {
  if (!(await exists(assetsDir)) || !(await exists(indexHtmlPath))) return;

  const reachable = await collectReachableAssets();
  const assetNames = await fs.readdir(assetsDir);
  let deletedCount = 0;
  let deletedBytes = 0;

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
    const deletedKiB = Math.round(deletedBytes / 1024);
    console.log(`[postbuild] Removed ${deletedCount} orphaned client assets (${deletedKiB} KiB freed)`);
  } else {
    console.log("[postbuild] No orphaned client assets found");
  }
}

await cleanOrphanedAssets();
