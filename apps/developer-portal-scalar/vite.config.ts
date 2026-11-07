import { defineConfig } from 'vite';

export default defineConfig({
	base: '/api/reference/',
	build: {
		emptyOutDir: true,
		outDir: 'dist',
		chunkSizeWarningLimit: 3500,
	},
});
