import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { cloudflare } from "@cloudflare/vite-plugin";
import tailwind from "@tailwindcss/vite"
import path from "path";
import runableWebsiteRuntime from "runable-website-runtime"
import runableAnalyticsPlugin from "./vite/plugins/runable-analytics-plugin";
import honoDevPlugin from "./vite/plugins/hono-dev-plugin";
import cleanOrphanedChunksPlugin from "./vite/plugins/clean-orphaned-chunks";


export default defineConfig({
	plugins: [react(), runableAnalyticsPlugin(), runableWebsiteRuntime(), cloudflare(), tailwind(), honoDevPlugin(), cleanOrphanedChunksPlugin()],
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
		rollupOptions: {
			output: {
				manualChunks: (id) => {
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
				},
			},
		},
	},
});
