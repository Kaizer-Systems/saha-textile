/// <reference types="vitest" />

import angular from '@analogjs/vite-plugin-angular';
import { defineConfig } from 'vite';

// The Release Console: a client-only Angular app on the owner's computer (no server rendering,
// never deployed). Its local API listens on 127.0.0.1:4410.
export default defineConfig(() => ({
	server: { port: 4400, host: 'localhost', strictPort: true },
	preview: { port: 4400, host: 'localhost', strictPort: true },
	build: { target: ['es2022'] },
	resolve: { mainFields: ['module'] },
	// The shared contracts are compiled to CommonJS; pre-bundling turns them into ES modules in dev.
	optimizeDeps: { include: ['@saha-textile/release-console-contracts'] },
	plugins: [angular({ tsconfig: 'tsconfig.app.json' })],
	test: {
		globals: true,
		environment: 'jsdom',
		setupFiles: ['src/test-setup.ts'],
		include: ['**/*.spec.ts'],
		reporters: ['default'],
	},
}));
