import type { Plugin } from "vite";

/**
 * Forces the Cloudflare Worker build to use inlineDynamicImports.
 * 
 * The @cloudflare/vite-plugin creates a separate Rollup build for the worker
 * that splits code into chunks with dynamic imports. This causes "Load failed"
 * on deploy because:
 * 1. With no_bundle:true, wrangler won't resolve dynamic imports
 * 2. Even without no_bundle, the chunk structure can confuse the deploy pipeline
 * 
 * This plugin intercepts the worker build's config and forces everything
 * into a single file. It also scopes the top-level manualChunks to client only,
 * since manualChunks conflicts with inlineDynamicImports.
 */
export default function workerInlinePlugin(): Plugin {
  return {
    name: "worker-inline-dynamic-imports",
    apply: "build",
    enforce: "post",
    config(config) {
      // The CF plugin creates an environment called "sandbox_website_template"
      // We need to set inlineDynamicImports for that environment's build
      if (config.environments?.sandbox_website_template) {
        const env = config.environments.sandbox_website_template;
        if (!env.build) env.build = {};
        if (!env.build.rollupOptions) env.build.rollupOptions = {};
        
        // Force single file output - override any output config
        env.build.rollupOptions.output = {
          inlineDynamicImports: true,
        };
        
        console.log("[worker-inline] Forced inlineDynamicImports for worker build");
      }
      
      // Move manualChunks to client environment only so it doesn't bleed into worker
      if (config.build?.rollupOptions?.output) {
        const output = config.build.rollupOptions.output as any;
        if (output.manualChunks) {
          const manualChunks = output.manualChunks;
          // Store it for the client environment
          if (!config.environments) config.environments = {};
          if (!config.environments.client) config.environments.client = {};
          if (!config.environments.client.build) config.environments.client.build = {};
          if (!config.environments.client.build.rollupOptions) config.environments.client.build.rollupOptions = {};
          if (!config.environments.client.build.rollupOptions.output) config.environments.client.build.rollupOptions.output = {};
          (config.environments.client.build.rollupOptions.output as any).manualChunks = manualChunks;
          
          // Remove from top level so it doesn't affect worker
          delete output.manualChunks;
          console.log("[worker-inline] Moved manualChunks to client environment only");
        }
      }
      
      return config;
    },
  };
}
