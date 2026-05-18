# Publish Fix Task

## Root Causes Found
1. `package.json` build script is just `"vite build"` — missing `&& node scripts/postbuild.mjs`
2. Worker output has `no_bundle: true` in wrangler.json (postbuild should strip it)
3. Worker output has tons of internal CF fields in wrangler.json
4. Worker is split into multiple chunks with dynamic imports (vendor-runable, vendor-auth, etc.)
5. Badge plugin may inject into worker entry (need to verify)

## Fix Plan
1. Fix build script: `"vite build && node scripts/postbuild.mjs"`
2. Add `inlineDynamicImports: true` for worker build via rollup options to collapse worker into single file
3. Verify postbuild.mjs still works correctly
4. Build and verify output
5. Deliver and test publish

## Status
- [ ] Fix build script
- [ ] Add worker inline config  
- [ ] Build and verify
- [ ] Deliver and publish
