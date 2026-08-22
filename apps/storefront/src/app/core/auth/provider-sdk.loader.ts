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

/**
 * How long to wait for Meta to announce itself before giving up on the provider.
 *
 * `fbAsyncInit` is the ONLY signal that the SDK has finished installing itself. If it never
 * arrives — a blocked request that still fired `onload`, a partially applied script, a version
 * Meta changed under us — the button must settle into its unavailable state rather than sit
 * armed against an object that will never work. Generous, because this runs off the critical
 * path and nobody is waiting on it.
 */
const FACEBOOK_INIT_TIMEOUT_MS = 15_000;

/** Everything `google.accounts.id.initialize` is given, in one named shape. */
export interface GoogleInitializeOptions {
	client_id: string;
	callback: (response: { credential: string }) => void;
	nonce?: string;
	auto_select?: boolean;
	cancel_on_tap_outside?: boolean;
}

/** The slice of Google Identity Services this app uses. */
export interface GoogleIdentityApi {
	accounts: {
		id: {
			initialize(options: GoogleInitializeOptions): void;
			renderButton(parent: HTMLElement, options: Record<string, unknown>): void;
			/**
			 * Revokes the OAuth grant this site holds for one Google account.
			 *
			 * Scoped to OUR client and nothing else. It does not touch the person's Google
			 * session: they stay signed in to Google here and in every other tab. The only
			 * consequence is that the next press asks them to pick an account and approve
			 * Saha Textile again. Verified against Google's own reference, which describes it
			 * as revoking "the OAuth grant used to share the ID token", and confirmed as an
			 * owner decision — the re-consent is acceptable; a sign-out would not have been.
			 */
			revoke(hint: string, callback: (response: { successful: boolean }) => void): void;
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

	/**
	 * Whether `google.accounts.id.initialize` has run in THIS page.
	 *
	 * GIS keeps its configuration on a global, so "has it been initialised" is a property of the
	 * page rather than of any component — and GIS gives no way to ask. Tracked here because this
	 * service is the one thing that owns the global's lifecycle, and because `revoke()` is
	 * refused outright before the first `initialize()`.
	 */
	private googleInitialized = false;

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

	/**
	 * Configures GIS, and records that it has been configured.
	 *
	 * Routed through the service rather than called on the API directly so that the flag cannot
	 * drift from the fact. The alternative — every caller remembering to report back — is the
	 * same shape of bug as a hand-copied enum.
	 */
	async initializeGoogle(options: GoogleInitializeOptions): Promise<GoogleIdentityApi | null> {
		const api = await this.loadGoogle();
		if (!api) return null;
		api.accounts.id.initialize(options);
		this.googleInitialized = true;
		return api;
	}

	/**
	 * Hands back this site's OAuth grant for one Google account.
	 *
	 * ## Why this initialises first
	 *
	 * GIS answers `revoke()` before `initialize()` with a refusal — "Attempt to call revoke()
	 * before initialize()" in the console, and nothing revoked. The screen that needs to revoke
	 * is precisely the screen that never renders the button: a registration form resumed from a
	 * Google signup HIDES the provider buttons, so nothing there had configured the SDK. The call
	 * failed silently and the grant stayed, on exactly the path it exists to clear.
	 *
	 * Only when nothing has configured it yet, so the ordinary path — where the button armed
	 * itself and then the person walked away — does not pay for a second `initialize()` and the
	 * warning that comes with one.
	 *
	 * `auto_select: false` is stated rather than assumed: this configuration exists to make one
	 * revocation legal, and it must not leave a page able to sign somebody in on its own.
	 */
	async revokeGoogleGrant(hint: string): Promise<boolean> {
		const api = await this.loadGoogle();
		if (!api) return false;

		if (!this.googleInitialized) {
			api.accounts.id.initialize({
				client_id: runtimeConfig.googleClientId,
				callback: () => undefined,
				auto_select: false,
			});
			this.googleInitialized = true;
		}

		api.accounts.id.revoke(hint, () => undefined);
		return true;
	}

	private async resolveGoogle(): Promise<GoogleIdentityApi | null> {
		if (!isPlatformBrowser(this.platformId) || !this.googleConfigured) return null;
		if (!(await this.loadScript(GOOGLE_SRC))) return null;
		return (window as WindowWithProviders).google ?? null;
	}

	/**
	 * Resolves a Meta API that reads `window.FB` at CALL time, never a captured reference.
	 *
	 * ## The bug this shape exists to make impossible
	 *
	 * This method used to read `window.FB` straight after the script's `onload` and hand that
	 * object out. Meta's SDK REPLACES `window.FB` during its own initialisation — which is the
	 * entire reason `fbAsyncInit` exists — so what we were holding was the loader's stub. Its
	 * `login` enqueues the call into a queue that the real SDK never flushes, because by then
	 * nothing is pointing at the stub any more. It accepted the call, returned cleanly, opened
	 * no popup and called back never. Four states minted, none consumed, no error anywhere.
	 *
	 * Two changes together, and both are needed:
	 *
	 * 1. **Wait for `fbAsyncInit`.** Installed BEFORE the script tag, because the SDK fires it
	 *    the moment it is ready and there is no way to ask afterwards whether it already did.
	 *    `init()` is called from inside it, on the object that exists at that moment.
	 * 2. **Never cache the result.** The façade below resolves `window.FB` on every call. Even
	 *    a correctly-timed capture is a bet that Meta will not swap the object again; reading it
	 *    live costs one property access and removes the bet.
	 *
	 * Note what could NOT have caught this: sampling `window.FB` twice after load and finding
	 * the same object. The swap has already happened by then. The measurement looks like
	 * evidence and is worth nothing.
	 */
	private async resolveFacebook(): Promise<FacebookApi | null> {
		if (!isPlatformBrowser(this.platformId) || !this.facebookConfigured) return null;

		const win = window as WindowWithProviders;

		// Armed before the script is appended. Chaining any existing hook rather than replacing
		// it: this service is the only caller today, but a global that silently drops somebody
		// else's callback is a trap for whoever adds the second one.
		const ready = new Promise<boolean>((resolve) => {
			const previous = win.fbAsyncInit;
			win.fbAsyncInit = () => {
				previous?.();
				const live = win.FB;
				if (live) {
					// `cookie: false` deliberately: the Meta SDK's own cookie is a second session
					// this app has no use for. Our session is the API's httpOnly cookie, and
					// nothing else. `xfbml: false` because no Meta-rendered social plugin is used.
					live.init({
						appId: runtimeConfig.facebookAppId,
						cookie: false,
						xfbml: false,
						version: 'v21.0',
					});
				}
				resolve(Boolean(live));
			};
			setTimeout(() => resolve(false), FACEBOOK_INIT_TIMEOUT_MS);
		});

		if (!(await this.loadScript(FACEBOOK_SRC))) return null;
		if (!(await ready)) return null;

		return this.liveFacebook();
	}

	/**
	 * The façade handed to callers: same interface, resolved against the live global each time.
	 *
	 * Deliberately NOT `window.FB` itself. A caller holding this can be armed long before a
	 * click and still reach whatever object Meta has installed by the time the click happens,
	 * which is what lets `signInWithFacebook` stay synchronous inside the user gesture — the
	 * other half of why the popup never opened.
	 *
	 * A missing global answers the callback with a dismissal rather than throwing. The button
	 * treats that as "the person closed the dialog", which is the honest description of what
	 * they experienced, and it recovers rather than stranding.
	 */
	private liveFacebook(): FacebookApi {
		const win = window as WindowWithProviders;
		return {
			init: (options) => win.FB?.init(options),
			login: (callback, options) => {
				const api = win.FB;
				if (!api) {
					callback({ authResponse: null, status: 'unknown' });
					return;
				}
				api.login(callback, options);
			},
		};
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
