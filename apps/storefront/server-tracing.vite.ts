import { defineConfig } from 'vite';

/**
 * Builds dist/analog/tracing.mjs from server-tracing.ts: one Node module with its packages bundled in,
 * because the shop's server image carries no node_modules. Run after the app's own build.
 */
export default defineConfig({
	build: {
		ssr: 'server-tracing.ts',
		outDir: 'dist/analog',
		emptyOutDir: false,
		target: 'node24',
		rollupOptions: { output: { entryFileNames: 'tracing.mjs', format: 'es' } },
	},
	ssr: { noExternal: true, target: 'node' },
});
