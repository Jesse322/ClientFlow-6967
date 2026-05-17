import fs from "node:fs";
import path from "node:path";
import type { Plugin } from "vite";

/**
 * Removes orphaned Rollup chunks from the dist/assets folder after build.
 *
 * The runable-website-runtime badge plugin injects a dynamic import into main.tsx,
 * which causes Rollup to generate a parallel set of chunks (the badge's module graph).
 * These chunks are never referenced from index.html and are never loaded by the browser.
 * Removing them reduces file count and total upload size significantly.
 */
export default function cleanOrphanedChunksPlugin(): Plugin {
  return {
    name: "clean-orphaned-chunks",
    apply: "build",
    enforce: "post",
    closeBundle() {
      const distDir = path.resolve(process.cwd(), "dist");
      const assetsDir = path.join(distDir, "assets");

      if (!fs.existsSync(assetsDir)) return;

      const htmlPath = path.join(distDir, "index.html");
      if (!fs.existsSync(htmlPath)) return;

      const html = fs.readFileSync(htmlPath, "utf-8");

      // BFS from index.html to find all reachable assets
      const reachable = new Set<string>();
      const queue: string[] = [];

      const refs = [...html.matchAll(/\/assets\/([^"']+)/g)].map((m) => m[1]);
      for (const r of refs) {
        reachable.add(r);
        queue.push(r);
      }

      const visited = new Set<string>();
      while (queue.length > 0) {
        const fname = queue.pop()!;
        if (visited.has(fname)) continue;
        visited.add(fname);

        const fpath = path.join(assetsDir, fname);
        if (!fs.existsSync(fpath)) continue;

        try {
          const content = fs.readFileSync(fpath, "utf-8");
          const imports = [...content.matchAll(/["']assets\/([^"']+\.js)["']/g)].map((m) => m[1]);
          for (const imp of imports) {
            if (!reachable.has(imp)) {
              reachable.add(imp);
              queue.push(imp);
            }
          }
        } catch {
          // skip binary files
        }
      }

      // Delete unreachable JS files
      const allFiles = fs.readdirSync(assetsDir);
      let deletedCount = 0;
      let deletedSize = 0;

      for (const fname of allFiles) {
        if (!fname.endsWith(".js")) continue;
        if (!reachable.has(fname)) {
          const fpath = path.join(assetsDir, fname);
          const size = fs.statSync(fpath).size;
          fs.unlinkSync(fpath);
          deletedCount++;
          deletedSize += size;
        }
      }

      if (deletedCount > 0) {
        console.log(
          `\n[clean-orphaned-chunks] Removed ${deletedCount} orphaned chunks (${Math.round(deletedSize / 1024)}KB freed)`
        );
      }
    },
  };
}
