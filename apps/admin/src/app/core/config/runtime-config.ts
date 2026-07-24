import { provideAppInitializer } from '@angular/core';

import { environment } from '../../../../public/environments/environment';

/**
 * Public runtime configuration (locked env/secrets model, roadmap §0b):
 * browser-facing, NON-SECRET config is delivered per environment via
 * `public/config.json`, fetched at app init — never baked into the bundle
 * with fileReplacements. The committed config.json holds localhost defaults
 * only; deploys overwrite/mount it at container start (roadmap §0d).
 */
export interface RuntimeConfig {
	/** NestJS API origin, e.g. http://localhost:4000 */
	apiUrl: string;
	/** Admin app origin, e.g. http://localhost:4300 */
	adminUrl: string;
}

const DEFAULTS: RuntimeConfig = {
	apiUrl: 'http://localhost:4000',
	adminUrl: 'http://localhost:4300',
};

/** Mutable singleton — read this (or the legacy `environment`) after app init. */
export const runtimeConfig: RuntimeConfig = { ...DEFAULTS };

function applyConfig(loaded: Partial<RuntimeConfig>): void {
	Object.assign(runtimeConfig, loaded);
	// Keep the legacy mutable `environment` object (still imported across the
	// app) in sync so existing consumers pick up the runtime values.
	environment.apiUrl = runtimeConfig.apiUrl;
	environment.URL = `${runtimeConfig.adminUrl}/assets/data`;
}

export async function loadRuntimeConfig(): Promise<void> {
	if (typeof window === 'undefined') {
		// Admin is CSR-only today; guard kept for safety if SSR is ever added.
		applyConfig({});
		return;
	}
	try {
		const res = await fetch('/config.json', { cache: 'no-store' });
		applyConfig(res.ok ? ((await res.json()) as Partial<RuntimeConfig>) : {});
	} catch {
		// Config fetch must never block boot — fall back to localhost defaults.
		applyConfig({});
	}
}

export function provideRuntimeConfig() {
	return provideAppInitializer(loadRuntimeConfig);
}
