import { provideAppInitializer } from '@angular/core';

import { environment } from '../../../../public/environments/environment';

/**
 * Public runtime configuration (locked env/secrets model, roadmap §0b):
 * browser-facing, NON-SECRET config is delivered per environment via
 * `public/config.json`, fetched at app init — never baked into the bundle
 * with fileReplacements. The committed config.json holds localhost defaults
 * only; in deployments the edge Nginx serves the real one. Mounting it into the
 * container does not work: the server would cut it to the committed file's size.
 */
export interface RuntimeConfig {
	/** NestJS API origin, e.g. https://localhost:4000 */
	apiUrl: string;
	/** Public storefront origin, e.g. https://localhost:4200 */
	siteUrl: string;
	defaultLocale: string;
	supportedLocales: string[];
	/**
	 * Public provider identifiers for the social sign-in buttons.
	 *
	 * PUBLIC by design — a Google client id and a Meta app id are meant to be visible in the
	 * page, which is why they may live in runtime config at all. The corresponding SECRETS are
	 * API-only and must never reach a bundle, local storage or a log; nothing here is a
	 * credential.
	 *
	 * Empty means "not configured", and the button is simply not rendered. A half-configured
	 * provider must never present a button that cannot work.
	 */
	googleClientId: string;
	facebookAppId: string;
}

const DEFAULTS: RuntimeConfig = {
	apiUrl: 'https://localhost:4000',
	siteUrl: 'https://localhost:4200',
	defaultLocale: 'en',
	// English and Bengali (Bengali replaced French on 2026-11-08).
	// Bengali is added once development is complete, deliberately: building against two
	// live locales keeps the i18n seams exercised, so a third is a data change rather
	// than an architecture change. Must agree with `availableLangs` in `app.config.ts`.
	supportedLocales: ['en', 'bn'],
	googleClientId: '',
	facebookAppId: '',
};

/** Mutable singleton — read this (or the legacy `environment`) after app init. */
export const runtimeConfig: RuntimeConfig = { ...DEFAULTS };

function applyConfig(loaded: Partial<RuntimeConfig>): void {
	Object.assign(runtimeConfig, loaded);
	// Keep the legacy mutable `environment` object (still imported across the
	// app) in sync so existing consumers pick up the runtime values.
	environment.apiUrl = runtimeConfig.apiUrl;
	environment.baseURL = `${runtimeConfig.siteUrl}/`;
	environment.URL = `${runtimeConfig.siteUrl}/assets/data`;
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
 * Resolves once `apiUrl` and friends hold their real values.
 *
 * Angular starts app initializers concurrently, so anything that needs the API origin —
 * the session bootstrap, for one — must await this rather than assume it ran second. It
 * resolves from a `finally`, so a failed config never hangs the application. On a local host a
 * failed fetch boots with the defaults; a deployed host refuses to start instead.
 */
export const runtimeConfigReady: Promise<void> = new Promise<void>((resolve) => {
	markReady = resolve;
});

/** Offline, an installed app has no way to fetch the config, and that is not a broken deployment. */
export async function loadServedConfig(hostname = location.hostname, online = navigator.onLine): Promise<void> {
	let served: Partial<RuntimeConfig> = {};
	try {
		const res = await fetch('/config.json', { cache: 'no-store' });
		if (res.ok) served = (await res.json()) as Partial<RuntimeConfig>;
	} catch {
		served = {};
	}
	if (!LOCAL_HOST.test(hostname) && online) assertDeployedConfig(served);
	applyConfig(served);
}

export async function loadRuntimeConfig(): Promise<void> {
	try {
		if (typeof window === 'undefined') {
			// SSR (Analog/Nitro): no browser fetch of a relative URL. Deploys inject the same
			// JSON via env; only a local run may fall back to the localhost defaults.
			const raw = process.env['SAHA_TEXTILE_PUBLIC_CONFIG'];
			const injected = raw ? (JSON.parse(raw) as Partial<RuntimeConfig>) : {};
			if (['staging', 'production'].includes(process.env['DEPLOY_ENV'] ?? '')) assertDeployedConfig(injected);
			applyConfig(injected);
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
