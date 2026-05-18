import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { cloudflare } from "@cloudflare/vite-plugin";
import tailwind from "@tailwindcss/vite"
import path from "path";
import runableWebsiteRuntime from "runable-website-runtime"
import runableAnalyticsPlugin from "./vite/plugins/runable-analytics-plugin";
import honoDevPlugin from "./vite/plugins/hono-dev-plugin";
import cleanOrphanedChunksPlugin from "./vite/plugins/clean-orphaned-chunks";

function manualChunks(id: string) {
	if (!id.includes('node_modules')) return;
	if (id.includes('react-dom') || id.includes('react/')) return 'vendor-react';
	if (id.includes('@radix-ui') || id.includes('radix-ui') || id.includes('cmdk') || id.includes('vaul')) return 'vendor-ui';
	if (id.includes('recharts') || id.includes('d3-') || id.includes('victory')) return 'vendor-charts';
	if (id.includes('lucide')) return 'vendor-icons';
	if (id.includes('date-fns') || id.includes('dayjs') || id.includes('moment')) return 'vendor-date';
	if (id.includes('zod') || id.includes('react-hook-form') || id.includes('@hookform')) return 'vendor-forms';
	if (id.includes('better-auth') || id.includes('@better-auth')) return 'vendor-auth';
	if (id.includes('framer-motion')) return 'vendor-motion';
	if (id.includes('jspdf') || id.includes('jspdf-autotable') || id.includes('canvg') || id.includes('dompurify') || id.includes('html2canvas')) return 'vendor-pdf';
	if (id.includes('@libsql') || id.includes('libsql') || id.includes('hono') || id.includes('drizzle-orm') || id.includes('drizzle-kit')) return 'vendor-server';
	if (id.includes('sonner') || id.includes('wouter') || id.includes('next-themes') || id.includes('class-variance-authority') || id.includes('clsx') || id.includes('tailwind-merge')) return 'vendor-utils';
	if (id.includes('@ai-sdk') || id.includes('/ai/') || id.includes('ai/')) return 'vendor-ai';
	if (id.includes('@aws-sdk') || id.includes('@smithy')) return 'vendor-aws';
	if (id.includes('mathjs')) return 'vendor-math';
	if (id.includes('@tanstack')) return 'vendor-tanstack';
	if (id.includes('autumn-js') || id.includes('@runablehq')) return 'vendor-runable';
	if (id.includes('xlsx') || id.includes('iconv') || id.includes('cfb') || id.includes('codepage') || id.includes('ssf') || id.includes('fflate')) return 'vendor-xlsx';
	return 'vendor-misc';
}

/**
 * Force the worker (sandbox_website_template) build to inline all dynamic imports
 * into a single output file. CF Workers deployed as pre-built chunks cannot resolve
 * relative dynamic import() calls at runtime → "Load failed".
 * inlineDynamicImports:true collapses everything into worker-entry.js with no splits.
 */
function workerInlineDynamicImportsPlugin(): Plugin {
	return {
		name: "worker-inline-dynamic-imports",
		configEnvironment(name) {
			if (name !== "sandbox_website_template") return;
			return {
				build: {
					rollupOptions: {
						output: {
							inlineDynamicImports: true,
						},
					},
				},
			};
		},
	};
}

function clientManualChunksPlugin(): Plugin {
	return {
		name: "client-manual-chunks",
		configEnvironment(name) {
			if (name !== "client") return;

			return {
				build: {
					rollupOptions: {
						output: {
							manualChunks,
						},
					},
				},
			};
		},
	};
}

/**
 * runable-website-runtime injects `import('runable-badge-prod')` into any file
 * matching index.ts/index.js — including the worker entry (src/index.ts).
 * CF Workers don't support dynamic local chunk imports, so we must prevent
 * the badge injection from running on non-client files.
 *
 * This wrapper patches the plugin array returned by runableWebsiteRuntime()
 * so that the `transform` hook in `website-editor-badge` only fires for
 * files under src/web (the client entry), not src/index.ts (the worker entry).
 */
function patchRunableWebsiteRuntime(): Plugin[] {
	const plugins = (runableWebsiteRuntime() as unknown as Plugin[]);
	return plugins.map((p) => {
		if (p.name !== "website-editor-badge") return p;
		const originalTransform = p.transform as ((code: string, id: string) => unknown) | undefined;
		return {
			...p,
			transform(code: string, id: string) {
				// Only inject badge into client-side files (src/web), never the worker entry
				if (!id.includes("/src/web/")) return null;
				return originalTransform?.call(this, code, id) ?? null;
			},
		};
	});
}

export default defineConfig({
	plugins: [react(), runableAnalyticsPlugin(), ...patchRunableWebsiteRuntime(), cloudflare(), tailwind(), honoDevPlugin(), workerInlineDynamicImportsPlugin(), clientManualChunksPlugin(), cleanOrphanedChunksPlugin()],
	resolve: {
		alias: {
			"@": path.resolve(__dirname, "./src/web"),
			// Force all React imports to resolve to the same version (prevents duplicate bundles)
			"react": path.resolve(__dirname, "../../node_modules/.bun/react@19.2.4/node_modules/react"),
			"react-dom": path.resolve(__dirname, "../../node_modules/.bun/react-dom@19.2.4+b1ab299f0a400331/node_modules/react-dom"),
			"react/jsx-runtime": path.resolve(__dirname, "../../node_modules/.bun/react@19.2.4/node_modules/react/jsx-runtime"),
			"react/jsx-dev-runtime": path.resolve(__dirname, "../../node_modules/.bun/react@19.2.4/node_modules/react/jsx-dev-runtime"),
		},
	},
	server: {
		allowedHosts: true,
		host: true,
		port: 4200,
	},
	build: {
		chunkSizeWarningLimit: 600,
	},
});
