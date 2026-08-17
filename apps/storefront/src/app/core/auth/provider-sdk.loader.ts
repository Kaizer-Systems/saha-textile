import { isPlatformBrowser } from '@angular/common';
import { Injectable, PLATFORM_ID, inject } from '@angular/core';

import { runtimeConfig } from '@core/config/runtime-config';

/**
 * Loads the Google and Meta browser SDKs, once, and only in a browser.
 *
 * ## Why this is a service rather than a script tag
 *
 * Three properties that a `<script>` in `index.html` cannot give us:
 *
 * 1. **SSR safety.** The storefront renders on the server, where `document` does not exist.
 *    Touching it during a render pass throws and takes the whole page down — so every entry
 *    point here checks the platform first and resolves to "unavailable" rather than throwing.
 * 2. **Once.** Both SDKs install global singletons and misbehave when re-initialised. Two
 *    components asking at the same moment must share ONE in-flight promise, not race.
 * 3. **Not on every page.** These are third-party scripts on a shop; loading them on the
 *    catalogue to serve two auth screens is a performance and privacy cost for no benefit.
 *
 * ## What "unavailable" means
 *
 * A missing client id, a blocked network, an ad-blocker, a CSP refusal — all resolve to
 * `null`, never a rejection. The calling screen renders its no-provider state and the password
 * and OTP paths keep working. A social button that cannot load must never break sign-in.
 */

const GOOGLE_SRC = 'https://accounts.google.com/gsi/client';
const FACEBOOK_SRC = 'https://connect.facebook.net/en_US/sdk.js';

/** The slice of Google Identity Services this app uses. */
export interface GoogleIdentityApi {
	accounts: {
		id: {
			initialize(options: {
				client_id: string;
				callback: (response: { credential: string }) => void;
				nonce?: string;
				auto_select?: boolean;
				cancel_on_tap_outside?: boolean;
			}): void;
			renderButton(parent: HTMLElement, options: Record<string, unknown>): void;
		};
	};
}

/** The slice of the Meta JS SDK this app uses. */
export interface FacebookApi {
	init(options: { appId: string; cookie: boolean; xfbml: boolean; version: string }): void;
	login(
		callback: (response: { authResponse?: { accessToken?: string } | null; status?: string }) => void,
		options: { scope: string },
	): void;
}

type WindowWithProviders = Window & {
	google?: GoogleIdentityApi;
	FB?: FacebookApi;
	fbAsyncInit?: () => void;
};

@Injectable({ providedIn: 'root' })
export class ProviderSdkLoader {
	private readonly platformId = inject<Object>(PLATFORM_ID);

	/** In-flight or settled loads, keyed by src — this is what makes "once" true. */
	private readonly scripts = new Map<string, Promise<boolean>>();
	private google: Promise<GoogleIdentityApi | null> | null = null;
	private facebook: Promise<FacebookApi | null> | null = null;

	get googleConfigured(): boolean {
		return Boolean(runtimeConfig.googleClientId);
	}

	get facebookConfigured(): boolean {
		return Boolean(runtimeConfig.facebookAppId);
	}

	/** Resolves the GIS API, or null when it is unconfigured, server-side, or failed to load. */
	loadGoogle(): Promise<GoogleIdentityApi | null> {
		// Memoised on the SERVICE, not just the script: two components mounting together share
		// one promise and therefore one initialisation.
		this.google ??= this.resolveGoogle();
		return this.google;
	}

	loadFacebook(): Promise<FacebookApi | null> {
		this.facebook ??= this.resolveFacebook();
		return this.facebook;
	}

	private async resolveGoogle(): Promise<GoogleIdentityApi | null> {
		if (!isPlatformBrowser(this.platformId) || !this.googleConfigured) return null;
		if (!(await this.loadScript(GOOGLE_SRC))) return null;
		return (window as WindowWithProviders).google ?? null;
	}

	private async resolveFacebook(): Promise<FacebookApi | null> {
		if (!isPlatformBrowser(this.platformId) || !this.facebookConfigured) return null;
		if (!(await this.loadScript(FACEBOOK_SRC))) return null;

		const api = (window as WindowWithProviders).FB;
		if (!api) return null;

		// `cookie: false` deliberately: the Meta SDK's own cookie is a second session this app
		// has no use for. Our session is the API's httpOnly cookie, and nothing else.
		// `xfbml: false` because no Meta-rendered social plugin is used on the page.
		api.init({ appId: runtimeConfig.facebookAppId, cookie: false, xfbml: false, version: 'v21.0' });
		return api;
	}

	/**
	 * Appends a script once and reports whether it loaded.
	 *
	 * Resolves `false` on error rather than rejecting: a blocked or missing third-party script
	 * is an expected condition on the open web, not an exception. Callers branch on a boolean
	 * instead of wrapping every call site in a try.
	 */
	private loadScript(src: string): Promise<boolean> {
		const existing = this.scripts.get(src);
		if (existing) return existing;

		const loading = new Promise<boolean>((resolve) => {
			// An identical tag may already be present from a previous navigation within the SPA.
			const already = document.querySelector<HTMLScriptElement>(`script[src="${src}"]`);
			if (already) {
				resolve(true);
				return;
			}

			const script = document.createElement('script');
			script.src = src;
			script.async = true;
			script.defer = true;
			script.onload = () => resolve(true);
			script.onerror = () => resolve(false);
			document.head.appendChild(script);
		});

		this.scripts.set(src, loading);
		return loading;
	}
}
