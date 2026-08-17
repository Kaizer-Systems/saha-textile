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
	// en + fr for the whole development phase — Fastkart shipped both and they stay.
	// Bengali is added once development is complete, deliberately: building against two
	// live locales keeps the i18n seams exercised, so a third is a data change rather
	// than an architecture change. Must agree with `availableLangs` in `app.config.ts`.
	supportedLocales: ['en', 'fr'],
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

let markReady: () => void;

/**
 * Resolves once `apiUrl` and friends hold their real values.
 *
 * Angular starts app initializers concurrently, so anything that needs the API origin —
 * the session bootstrap, for one — must await this rather than assume it ran second. It
 * resolves from a `finally`, so a failed config fetch still unblocks boot with defaults
 * instead of hanging the application.
 */
export const runtimeConfigReady: Promise<void> = new Promise<void>((resolve) => {
	markReady = resolve;
});

export async function loadRuntimeConfig(): Promise<void> {
	try {
		if (typeof window === 'undefined') {
			// SSR (Analog/Nitro): no browser fetch of a relative URL. Deploys may
			// inject the same JSON via env; otherwise localhost defaults apply.
			const raw = process.env['SAHA_TEXTILE_PUBLIC_CONFIG'];
			applyConfig(raw ? (JSON.parse(raw) as Partial<RuntimeConfig>) : {});
			return;
		}
		try {
			const res = await fetch('/config.json', { cache: 'no-store' });
			applyConfig(res.ok ? ((await res.json()) as Partial<RuntimeConfig>) : {});
		} catch {
			// Config fetch must never block boot — fall back to localhost defaults.
			applyConfig({});
		}
	} finally {
		markReady();
	}
}

export function provideRuntimeConfig() {
	return provideAppInitializer(loadRuntimeConfig);
}
