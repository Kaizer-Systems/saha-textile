/// <reference types="vitest" />

import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';

import angular from '@analogjs/vite-plugin-angular';
import { defineConfig } from 'vite';

const appPath = (p: string) => fileURLToPath(new URL(p, import.meta.url));

/** Machine-local mkcert pair, or `null` when absent — see the storefront config. */
const localHttps = (() => {
	try {
		return {
			key: readFileSync(appPath('../../certs/localhost-key.pem')),
			cert: readFileSync(appPath('../../certs/localhost-cert.pem')),
		};
	} catch {
		return null;
	}
})();

// AnalogJS (Vite) build for the admin. Platform swap only — the app still uses
// Angular Router config + NGXS + ngx-translate (those migrate in later phases).
export default defineConfig(() => ({
	server: {
		port: 4300,
		host: 'localhost',
		// TLS locally so operator session cookies carry the same `Secure` + `__Host-`
		// attributes here as in production. `pnpm setup:local-https`.
		...(localHttps ? { https: localHttps } : {}),
	},
	css: {
		preprocessorOptions: {
			scss: {
				// The Fastkart theme + Bootstrap 5.3 lean on Sass APIs Dart Sass marks
				// deprecated; quiet the noise (no behavioural effect).
				quietDeps: true,
				silenceDeprecations: [
					'import',
					'global-builtin',
					'color-functions',
					'mixed-decls',
					'legacy-js-api',
					'slash-div',
				],
			},
		},
	},
	build: {
		target: ['es2020'],
	},
	resolve: {
		mainFields: ['module'],
		// Mirror the tsconfig path aliases so Vite/Nitro resolve + bundle them
		// (otherwise the SSR build externalises '@data-access/*' etc. as if they
		// were npm scoped packages).
		alias: {
			'@layout': appPath('./src/app/layout'),
			'@shared': appPath('./src/app/shared'),
			'@features': appPath('./src/app/features'),
			'@data-access': appPath('./src/app/data-access'),
			'@core': appPath('./src/app/core'),
		},
	},
	// SPA / client-rendered via the standalone Angular Vite plugin (no Nitro/SSR).
	// The admin is internal (behind login) — SSR adds no SEO/first-paint value and
	// conflicts with the zone.js-based Fastkart app. File-based routing + PWA come
	// in later phases on top of this client build.
	plugins: [angular()],
	test: {
		globals: true,
		environment: 'jsdom',
		setupFiles: ['src/test-setup.ts'],
		include: ['**/*.spec.ts'],
		reporters: ['default'],
	},
}));
