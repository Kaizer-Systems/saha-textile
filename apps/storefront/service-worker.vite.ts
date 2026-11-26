import { createHash } from 'node:crypto';

import { VitePWA } from 'vite-plugin-pwa';

import type { Plugin } from 'vite';

interface ManifestEntry {
	url: string;
	revision: string | null;
	size: number;
}

/**
 * Turns the build's file list into one marker, so nothing is precached yet `sw.js` still changes
 * whenever the build does. A byte change is the only thing that tells a browser to update.
 */
function buildMarker(entries: ManifestEntry[]) {
	const hash = createHash('sha256');
	for (const entry of [...entries].sort((a, b) => a.url.localeCompare(b.url))) {
		hash.update(`${entry.url}:${entry.revision ?? ''}\n`);
	}
	return Promise.resolve({
		manifest: [{ url: 'build', revision: hash.digest('hex').slice(0, 16), size: 0 }],
		warnings: [],
	});
}

/**
 * Analog builds through Vite's environment API and resolves this config three times, ending on
 * the server build. Left alone the plugin takes the last one for its own and writes no worker,
 * so it is kept to the client build, whose output Nitro then serves at the site root.
 */
function forClientBuildOnly(plugins: Plugin[]): Plugin[] {
	return plugins.map((plugin) => {
		const resolved = plugin.configResolved;
		if (typeof resolved !== 'function') return { ...plugin, applyToEnvironment: isClient };
		return {
			...plugin,
			applyToEnvironment: isClient,
			configResolved(this: unknown, config) {
				// The client build's folder: `dist/client`, or `<ST_BUILD_DIR>/client` for a side-by-side build.
				if (/[\\/]client$/.test(config.build.outDir)) return resolved.call(this as never, config);
			},
		};
	});
}

const isClient = (environment: { name: string }): boolean => environment.name === 'client';

/** Builds `src/service-worker/sw.ts` to `/sw.js`. The manifest is served by the shop's server. */
export function serviceWorkerPlugins(): Plugin[] {
	return forClientBuildOnly(
		VitePWA({
			strategies: 'injectManifest',
			srcDir: 'src/service-worker',
			filename: 'sw.ts',
			injectRegister: false,
			manifest: false,
			injectManifest: {
				globPatterns: ['**/*.{js,css}'],
				// The dark theme loads only when the shop's mode is dark, so light shoppers never download it. The vendor's
				// remixicon.css is the source of remixicon-shop.css (scripts/split-icon-font.mjs); no page links it.
				globIgnores: ['**/theme-dark.gen.css', '**/assets/css/remixicon.css'],
				maximumFileSizeToCacheInBytes: 16 * 1024 * 1024,
				manifestTransforms: [buildMarker],
			},
		}),
	);
}
