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
	/** NestJS API origin, e.g. https://localhost:4000 */
	apiUrl: string;
	/** Admin app origin, e.g. https://localhost:4300 */
	adminUrl: string;
}

const DEFAULTS: RuntimeConfig = {
	apiUrl: 'https://localhost:4000',
	adminUrl: 'https://localhost:4300',
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

/** Local names, including the `*.localhost` hosts of the mode-3 stack. */
const LOCAL_HOST = /(^|\.)localhost$|^127\.0\.0\.1$|^\[::1\]$/;

/**
 * Deployed, a missing or broken config must stop the app. Falling back would send every call to
 * localhost, which looks like a broken site with no visible cause.
 */
function assertDeployedConfig(loaded: Partial<RuntimeConfig>): void {
	const apiUrl = loaded.apiUrl ?? '';
	if (!URL.canParse(apiUrl) || LOCAL_HOST.test(new URL(apiUrl).hostname)) {
		throw new Error('Runtime config is missing or points at localhost: check /config.json.');
	}
}

let markReady: () => void;

/**
 * Resolves once `apiUrl` holds its real value.
 *
 * Angular starts app initializers concurrently, so anything needing the API origin — the
 * admin session bootstrap, for one — must await this rather than assume it ran second. It
 * resolves from a `finally`, so a failed config never hangs the application. On a local host a
 * failed fetch boots with the defaults; a deployed host refuses to start instead.
 */
export const runtimeConfigReady: Promise<void> = new Promise<void>((resolve) => {
	markReady = resolve;
});

export async function loadServedConfig(hostname = location.hostname): Promise<void> {
	let served: Partial<RuntimeConfig> = {};
	try {
		const res = await fetch('/config.json', { cache: 'no-store' });
		if (res.ok) served = (await res.json()) as Partial<RuntimeConfig>;
	} catch {
		served = {};
	}
	if (!LOCAL_HOST.test(hostname)) assertDeployedConfig(served);
	applyConfig(served);
}

export async function loadRuntimeConfig(): Promise<void> {
	try {
		if (typeof window === 'undefined') {
			// Admin is CSR-only today; guard kept for safety if SSR is ever added.
			applyConfig({});
			return;
		}
		await loadServedConfig();
	} finally {
		markReady();
	}
}

export function provideRuntimeConfig() {
	return provideAppInitializer(loadRuntimeConfig);
}
