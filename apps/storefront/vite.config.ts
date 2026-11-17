/// <reference types="vitest" />

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath, URL } from 'node:url';

import analog from '@analogjs/platform';
import { defineConfig, type Plugin } from 'vite';

import { serviceWorkerPlugins } from './service-worker.vite.ts';

const appPath = (p: string) => fileURLToPath(new URL(p, import.meta.url));

/**
 * The machine-local mkcert pair, or `null` when it has not been generated.
 *
 * Absent certificates degrade to HTTP rather than throwing, so `pnpm dev` still works on a
 * fresh clone; `pnpm setup:local-https` is what upgrades it. The pair is gitignored — a
 * private key stays private even when it is only trusted by one laptop.
 */
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

// AnalogJS (Vite + Nitro) build for the storefront. Unlike the admin (SPA, no
// SSR), the storefront keeps SSR — the Fastkart theme ships SSR-ready and SEO /
// first-paint matter for a public shop. Phase 5a swaps the SSR host only
// (Angular-CLI + @angular/ssr Express -> Analog Vite + Nitro); the app still
// uses the Angular Router config + NGXS + ngx-translate. File-based routing and
// the state-layer migration land in later phases on top of this platform.
/**
 * Angular skips browser-only work on the server (viewport and hover triggers of `@defer`, timers
 * meant for the page) by testing the global `ngServerMode`. Analog's build optimizer sets it once
 * from the top-level config, which carries no `build.ssr`, so the server bundle was compiled with
 * `ngServerMode = false` and ran those browser paths on the server (`IntersectionObserver is not
 * defined` from the product page's `@defer (on viewport)`). This sets it to `true` for every
 * server-side build environment; the browser build keeps Analog's `false`.
 */
const angularServerMode = (): Plugin => ({
	name: 'saha-textile:angular-server-mode',
	apply: 'build',
	configEnvironment(name, config) {
		if (name === 'client' || config.consumer === 'client') return undefined;
		return { define: { ngServerMode: 'true' } };
	},
});

/**
 * `ST_BUILD_DIR=<folder>` builds into that folder (client, server render and Nitro output under it) instead of
 * `dist/`, so a build can be measured beside a running shop without replacing the files that shop serves. Unset
 * (every normal build), nothing changes.
 */
const buildDir = process.env['ST_BUILD_DIR'] ? appPath(`./${process.env['ST_BUILD_DIR']}`) : null;

export default defineConfig(({ command }) => ({
	// Pin the project root to this file's dir (as the Analog template does) so
	// Vite behaves identically regardless of the launch cwd — otherwise resolution
	// (incl. the sass importer) drifts when started from the workspace root vs the
	// app dir.
	root: appPath('.'),
	server: {
		port: 4200,
		host: 'localhost',
		// TLS locally so the browser treats this origin exactly as it treats production:
		// `Secure` cookies are accepted, the `__Host-` prefix is valid, and Meta's JS SDK
		// (which refuses plain HTTP) works without relaxing anything. Certificates come from
		// the machine-local mkcert CA — `pnpm setup:local-https`. Missing certs fall back to
		// HTTP rather than failing boot, so a fresh clone still starts.
		...(localHttps ? { https: localHttps } : {}),
		fs: {
			// pnpm hoists node_modules to the workspace root; allow the app dir +
			// workspace root so Vite can serve theme assets and hoisted packages.
			allow: [appPath('.'), appPath('../..')],
		},
	},
	css: {
		preprocessorOptions: {
			scss: {
				// The Fastkart theme's app.scss @imports node_modules-prefixed paths
				// (e.g. `@import 'node_modules/bootstrap/dist/css/bootstrap.min.css'`)
				// and bare package specifiers. The Angular CLI resolved these via its
				// node_modules include path; Vite's sass doesn't by default, so give it
				// the same load paths. `node_modules/...`-prefixed imports resolve
				// against a dir that CONTAINS node_modules: the app root (pnpm keeps
				// most deps under apps/storefront/node_modules) and the workspace root
				// (hoisted deps). Also add the theme's scss dir + src. Without this:
				// "canonicalize() must return a URL" / "Can't find stylesheet to import"
				// (sass blames the root @import that pulls the chain in).
				loadPaths: [appPath('.'), appPath('../..'), appPath('./public/assets/scss'), appPath('./src')],
				// The Fastkart theme + Bootstrap 5.3 lean on Sass APIs Dart Sass marks
				// deprecated; quiet the noise (no behavioural effect).
				quietDeps: true,
				// NB: 'mixed-decls' is intentionally NOT listed — it's obsolete in the
				// current Dart Sass, and naming it makes sass warn on every compiled
				// file ("mixed-decls deprecation is obsolete"), flooding the dev log.
				silenceDeprecations: ['import', 'global-builtin', 'color-functions', 'legacy-js-api', 'slash-div'],
			},
		},
	},
	build: {
		target: ['es2020'],
		...(buildDir ? { outDir: `${buildDir}/client` } : {}),
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
			// Fastkart theme scss. It lives under src/ (NOT public/): Vite's dev sass
			// importer can't resolve @imports for files in public/ (public/ is served
			// as verbatim static assets, so those files get no module URL and relative
			// @imports fail with "canonicalize() must return a URL"). Image url()s in
			// the scss were made absolute (/assets/images/...) so they still resolve
			// from public/ regardless of the scss location.
			'@styles': appPath('./src/scss'),
		},
	},
	// Full Analog platform: Vite + Nitro SSR (ssr defaults on). Nitro emits a
	// node-server for production (`node dist/analog/server/index.mjs`).
	plugins: [
		// Production only: development has no `sw.js`, so a page there is never held by an old one.
		...(command === 'build' ? serviceWorkerPlugins() : []),
		angularServerMode(),
		analog({
			ssr: true,
			...(buildDir ? { ssrBuildDir: `${buildDir}/ssr` } : {}),
			static: false,
			// No prerendering: the shop is fully dynamic — every route self-fetches
			// i18n + mock data over HTTP, which has no server to hit at build time.
			// Pages render on-demand via the live Nitro SSR server instead.
			prerender: {
				routes: [],
			},
			nitro: {
				preset: 'node-server',
				// Bundle tslib into the server output instead of externalising it. Its
				// package `exports` uses a deprecated trailing-slash mapping, so Nitro's
				// node-server can't resolve the emitted `tslib/modules/index.js` at
				// runtime (ERR_MODULE_NOT_FOUND on every SSR request). Inlining it fixes
				// the built server without affecting the client bundle.
				externals: {
					inline: ['tslib'],
					// The critical-CSS worker loads Beasties by name (server/plugins/critical-css.ts), so the server
					// output must carry it although no bundled module imports it.
					traceInclude: [createRequire(import.meta.url).resolve('beasties')],
				},
				...(buildDir ? { output: { dir: `${buildDir}/analog`, publicDir: `${buildDir}/analog/public` } } : {}),
				prerender: {
					crawlLinks: false,
					routes: [],
				},
				// The browser must always be able to see a new service worker. Without this, an
				// edge cache could hold the old file back and shoppers would stay on the old build.
				routeRules: {
					'/sw.js': { headers: { 'Cache-Control': 'no-cache' } },
				},
			},
		}),
	],
	test: {
		globals: true,
		environment: 'jsdom',
		setupFiles: ['src/test-setup.ts'],
		include: ['**/*.spec.ts'],
		reporters: ['default'],
	},
}));
