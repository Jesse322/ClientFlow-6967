# Load Failed — Root Cause Analysis

## What was wrong (multiple issues fixed over 2 days)

### Issue 1: `no_bundle:true` in dist wrangler.json
The Cloudflare Vite plugin writes `no_bundle:true` into `dist/sandbox_website_template/wrangler.json`. 
This tells wrangler to skip bundling and deploy pre-built chunks as-is. But V8 in CF Workers can't resolve 
bare Node imports (`stream`, `crypto`, etc.) without wrangler's bundler rewriting them.
**Fix:** postbuild step 2 strips `no_bundle` from the wrangler.json.

### Issue 2: Badge injection into worker entry
`runable-website-runtime` v0.0.14 `badgeOnlyPlugin()` injects `import('virtual:runable-badge')` into 
any file matching `index.ts` — including the worker entry. This creates a dynamic chunk that CF Workers can't resolve.
**Fix:** `patchRunableWebsiteRuntime()` in vite.config.ts limits badge injection to `src/web/` files only.

### Issue 3: Worker code-splitting
Even without the badge, the worker was being split into multiple chunks with dynamic imports between them.
CF Workers pre-built deployments can't resolve relative dynamic imports.
**Fix:** `workerInlineDynamicImportsPlugin()` forces `inlineDynamicImports: true` for the worker env.

### Issue 4: `.wrangler/deploy/config.json` redirecting to dirty config
The CF Vite plugin creates this file pointing to the pre-built dist config (with `no_bundle:true`).
**Fix:** postbuild step 4 deletes it.

### Issue 5: `public/` was stale (if platform serves from there)
Old build output in `public/assets/` included the badge chunk.
**Fix:** postbuild step 5 syncs `dist/client/` → `public/`.

## Current state (verified clean)
- `dist/sandbox_website_template/wrangler.json`: clean, no `no_bundle`
- `dist/sandbox_website_template/index.js`: single 2.6MB file, only `node:` dynamic imports
- `dist/client/`: all 44 chunks exist, all referenced by dynamic imports exist
- `public/`: synced from dist/client, no badge chunk
- `.wrangler/deploy/config.json`: deleted by postbuild
- Git: all committed and pushed

## If it still fails
The "Load failed" error might be from:
1. The platform caching a previous failed deploy
2. The platform not running `bun run build` (using stale dist/)
3. Something in the platform's own deploy pipeline unrelated to our code
