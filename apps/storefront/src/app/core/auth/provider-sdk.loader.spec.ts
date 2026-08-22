import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runtimeConfig } from '@core/config/runtime-config';

import { ProviderSdkLoader } from './provider-sdk.loader';

/**
 * The three properties a `<script>` tag in `index.html` could not give us: it must not touch
 * `document` on the server, it must load once however many callers ask, and it must degrade to
 * "unavailable" rather than throwing when a third-party script is blocked.
 *
 * Two more were added after a browser session found what none of the above could see:
 *
 * - **The Meta SDK is a moving target.** `resolveFacebook` used to read `window.FB` straight
 *   after `onload` and hand that object out; Meta REPLACES it during its own initialisation,
 *   which is the entire reason `fbAsyncInit` exists. What the button held was the loader's stub,
 *   whose `login` enqueues into a queue the real SDK never flushes — it accepted the call,
 *   returned cleanly, opened no popup and called back never. Four states minted, none consumed,
 *   no error anywhere on the page. The cases below assert on object IDENTITY, because outcome
 *   could not tell the two apart.
 * - **GIS refuses `revoke()` before `initialize()`** and offers no way to ask whether it has been
 *   initialised. The screen that revokes is precisely the one that never renders the button, so
 *   the call failed silently on the only path it exists for.
 */

const GOOGLE_SRC = 'https://accounts.google.com/gsi/client';
const FACEBOOK_SRC = 'https://connect.facebook.net/en_US/sdk.js';

function makeLoader(platform: 'browser' | 'server'): ProviderSdkLoader {
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [ProviderSdkLoader, { provide: PLATFORM_ID, useValue: platform }],
	});
	return TestBed.inject(ProviderSdkLoader);
}

/** Resolves every injected script by firing `onload` on the next tick. */
function autoResolveScripts(succeed: boolean): () => void {
	const original = document.head.appendChild.bind(document.head);
	document.head.appendChild = ((node: Node) => {
		const script = node as HTMLScriptElement;
		queueMicrotask(() => (succeed ? script.onload?.(new Event('load')) : script.onerror?.(new Event('error'))));
		return original(node);
	}) as typeof document.head.appendChild;
	return () => {
		document.head.appendChild = original;
	};
}

describe('ProviderSdkLoader', () => {
	let restore = () => {};

	beforeEach(() => {
		runtimeConfig.googleClientId = '1234.apps.googleusercontent.com';
		runtimeConfig.facebookAppId = '1234567890';
		document.querySelectorAll('script').forEach((script) => script.remove());
		delete (window as { google?: unknown }).google;
		delete (window as { FB?: unknown }).FB;
	});

	afterEach(() => {
		restore();
		restore = () => {};
		runtimeConfig.googleClientId = '';
		runtimeConfig.facebookAppId = '';
	});

	/**
	 * The one that would take the whole page down. The storefront renders on the server, where
	 * `document` does not exist — so this must answer without touching it, not throw.
	 */
	it('resolves to unavailable on the server without injecting a script', async () => {
		const loader = makeLoader('server');

		await expect(loader.loadGoogle()).resolves.toBeNull();
		await expect(loader.loadFacebook()).resolves.toBeNull();
		expect(document.querySelector(`script[src="${GOOGLE_SRC}"]`)).toBeNull();
	});

	it('does not load anything when the provider is unconfigured', async () => {
		runtimeConfig.googleClientId = '';
		const loader = makeLoader('browser');

		expect(loader.googleConfigured).toBe(false);
		await expect(loader.loadGoogle()).resolves.toBeNull();
		expect(document.querySelector(`script[src="${GOOGLE_SRC}"]`)).toBeNull();
	});

	/**
	 * Both SDKs install global singletons and misbehave when re-initialised, so two components
	 * mounting at the same moment must share ONE in-flight promise rather than race.
	 */
	it('injects the script once however many callers ask, concurrently', async () => {
		restore = autoResolveScripts(true);
		(window as { google?: unknown }).google = { accounts: { id: {} } };
		const loader = makeLoader('browser');

		const [a, b, c] = await Promise.all([loader.loadGoogle(), loader.loadGoogle(), loader.loadGoogle()]);

		expect(document.querySelectorAll(`script[src="${GOOGLE_SRC}"]`)).toHaveLength(1);
		expect(a).toBe(b);
		expect(b).toBe(c);
	});

	it('returns the same promise for sequential calls', async () => {
		restore = autoResolveScripts(true);
		(window as { google?: unknown }).google = { accounts: { id: {} } };
		const loader = makeLoader('browser');

		await loader.loadGoogle();
		await loader.loadGoogle();

		expect(document.querySelectorAll(`script[src="${GOOGLE_SRC}"]`)).toHaveLength(1);
	});

	/**
	 * An ad-blocker, a CSP refusal or an offline visitor is an EXPECTED condition on the open
	 * web, not an exception. Rejecting here would force every call site into a try/catch and, if
	 * one forgot, break a sign-in page over a third-party script.
	 */
	it('resolves to null rather than rejecting when the script fails to load', async () => {
		restore = autoResolveScripts(false);
		const loader = makeLoader('browser');

		await expect(loader.loadGoogle()).resolves.toBeNull();
	});

	it('resolves to null when the script loads but installs no global', async () => {
		restore = autoResolveScripts(true);
		const loader = makeLoader('browser');

		// Script present, `window.google` absent — a partial load must not read as success.
		await expect(loader.loadGoogle()).resolves.toBeNull();
	});
});

/** A recording stand-in for a provider global, distinguishable from every other one by `name`. */
function fakeFb(name: string) {
	return { name, init: vi.fn(), login: vi.fn() };
}

/**
 * Makes the Meta script "load" without a network.
 *
 * The loader short-circuits when a tag with the same `src` is already present, which is exactly
 * the hook a test needs: nothing is fetched, and everything after the load — the `fbAsyncInit`
 * handshake, which is what is actually under test — runs for real.
 */
function pretendFacebookScriptIsPresent(): void {
	const script = document.createElement('script');
	script.src = FACEBOOK_SRC;
	document.head.appendChild(script);
}

/** Meta announcing that the real SDK has replaced whatever was there before. */
function metaAnnouncesItself(replacement: unknown): void {
	const win = window as { FB?: unknown; fbAsyncInit?: () => void };
	win.FB = replacement;
	win.fbAsyncInit?.();
}

describe('the Meta SDK is resolved at call time, never captured', () => {
	beforeEach(() => {
		runtimeConfig.facebookAppId = '1234567890';
		pretendFacebookScriptIsPresent();
	});

	afterEach(() => {
		document.querySelectorAll(`script[src="${FACEBOOK_SRC}"]`).forEach((tag) => tag.remove());
		delete (window as { FB?: unknown }).FB;
		delete (window as { fbAsyncInit?: () => void }).fbAsyncInit;
	});

	it('calls the object Meta installed, not the stub that was there at load', async () => {
		const stub = fakeFb('loader-stub');
		(window as { FB?: unknown }).FB = stub;

		const loader = makeLoader('browser');
		const pending = loader.loadFacebook();

		const real = fakeFb('real-sdk');
		metaAnnouncesItself(real);

		const api = await pending;
		expect(api).not.toBeNull();

		api!.login(vi.fn(), { scope: 'public_profile,email' });

		expect(real.login).toHaveBeenCalledTimes(1);
		// The whole bug in one assertion: the stub accepted the call and did nothing with it.
		expect(stub.login).not.toHaveBeenCalled();
	});

	it('follows a further swap, because a correctly-timed capture is still a bet', async () => {
		(window as { FB?: unknown }).FB = fakeFb('loader-stub');
		const loader = makeLoader('browser');
		const pending = loader.loadFacebook();
		metaAnnouncesItself(fakeFb('real-sdk'));
		const api = await pending;

		const later = fakeFb('swapped-again');
		(window as { FB?: unknown }).FB = later;
		api!.login(vi.fn(), { scope: 'public_profile,email' });

		expect(later.login).toHaveBeenCalledTimes(1);
	});

	/**
	 * `init` belongs inside the handshake, and `cookie: false` is deliberate: Meta's own cookie
	 * would be a second session this app has no use for. Called on whatever was present at load
	 * time it would configure the object about to be thrown away, leaving the surviving SDK with
	 * no app id — the same failure as the stale `login`, one step earlier.
	 */
	it('initialises the object Meta installed, without its own cookie or XFBML', async () => {
		(window as { FB?: unknown }).FB = fakeFb('loader-stub');
		const loader = makeLoader('browser');
		const pending = loader.loadFacebook();

		const real = fakeFb('real-sdk');
		metaAnnouncesItself(real);
		await pending;

		expect(real.init).toHaveBeenCalledTimes(1);
		expect(real.init).toHaveBeenCalledWith(
			expect.objectContaining({ appId: '1234567890', cookie: false, xfbml: false }),
		);
	});

	/**
	 * The gesture rule, at the loader boundary. A browser only opens a popup inside the click
	 * that asked for it, so the façade's `login` must reach Meta SYNCHRONOUSLY — anything
	 * deferred here puts the popup back behind the wall it was behind before.
	 */
	it('reaches Meta synchronously, so the click still owns the popup', async () => {
		(window as { FB?: unknown }).FB = fakeFb('loader-stub');
		const loader = makeLoader('browser');
		const pending = loader.loadFacebook();
		const real = fakeFb('real-sdk');
		metaAnnouncesItself(real);
		const api = await pending;

		api!.login(vi.fn(), { scope: 'public_profile,email' });

		expect(real.login).toHaveBeenCalledTimes(1);
	});

	it('reports the provider unavailable when Meta never announces itself', async () => {
		vi.useFakeTimers();
		try {
			(window as { FB?: unknown }).FB = fakeFb('loader-stub');
			const loader = makeLoader('browser');
			const pending = loader.loadFacebook();

			await vi.advanceTimersByTimeAsync(15_000);

			// Null, not a rejection and not the stub: a provider we cannot drive is one the button
			// hides rather than one it offers and then fails on.
			await expect(pending).resolves.toBeNull();
		} finally {
			vi.useRealTimers();
		}
	});

	it('answers a vanished global with a dismissal rather than a throw', async () => {
		(window as { FB?: unknown }).FB = fakeFb('loader-stub');
		const loader = makeLoader('browser');
		const pending = loader.loadFacebook();
		metaAnnouncesItself(fakeFb('real-sdk'));
		const api = await pending;

		delete (window as { FB?: unknown }).FB;
		const callback = vi.fn();
		expect(() => api!.login(callback, { scope: 'public_profile,email' })).not.toThrow();
		expect(callback).toHaveBeenCalledWith({ authResponse: null, status: 'unknown' });
	});
});

/**
 * Configuring, and un-configuring, Google.
 *
 * GIS keeps its configuration on a global and offers no way to ask whether it has been
 * configured, so this service tracks it. The case that matters is the one a real browser found:
 * `revoke()` before `initialize()` is REFUSED, and the screen that revokes is precisely the one
 * that never renders the button, because a resumed social signup hides it.
 */
function installGoogle() {
	const id = { initialize: vi.fn(), renderButton: vi.fn(), revoke: vi.fn() };
	(window as { google?: unknown }).google = { accounts: { id } };
	const script = document.createElement('script');
	script.src = GOOGLE_SRC;
	document.head.appendChild(script);
	return id;
}

describe('Google is configured before it is asked to revoke', () => {
	beforeEach(() => {
		runtimeConfig.googleClientId = '1234.apps.googleusercontent.com';
	});

	afterEach(() => {
		document.querySelectorAll(`script[src="${GOOGLE_SRC}"]`).forEach((tag) => tag.remove());
		delete (window as { google?: unknown }).google;
		runtimeConfig.googleClientId = '';
	});

	it('initialises first when nothing on the page has', async () => {
		const id = installGoogle();
		const loader = makeLoader('browser');

		await expect(loader.revokeGoogleGrant('someone@example.test')).resolves.toBe(true);

		expect(id.initialize).toHaveBeenCalledTimes(1);
		expect(id.revoke).toHaveBeenCalledWith('someone@example.test', expect.any(Function));
		// A configuration that exists only to make one revocation legal must not leave the page
		// able to sign somebody in on its own.
		expect(id.initialize).toHaveBeenCalledWith(expect.objectContaining({ auto_select: false }));
	});

	/**
	 * The counterpart. Re-initialising is what Google logs `initialize() is called multiple
	 * times` for, and the ordinary path — button armed, person walks away — must not pay for it.
	 */
	it('does not re-initialise when the button already configured it', async () => {
		const id = installGoogle();
		const loader = makeLoader('browser');
		await loader.initializeGoogle({ client_id: 'client', callback: () => undefined });

		await loader.revokeGoogleGrant('someone@example.test');

		expect(id.initialize).toHaveBeenCalledTimes(1);
		expect(id.revoke).toHaveBeenCalledTimes(1);
	});

	/** An unconfigured provider is one we cannot revoke against, and saying so is the job. */
	it('reports failure rather than throwing when Google is unconfigured', async () => {
		runtimeConfig.googleClientId = '';
		const loader = makeLoader('browser');

		await expect(loader.revokeGoogleGrant('someone@example.test')).resolves.toBe(false);
	});
});
