import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { runtimeConfig } from '@core/config/runtime-config';

import { ProviderSdkLoader } from './provider-sdk.loader';

/**
 * The three properties a `<script>` tag in `index.html` could not give us: it must not touch
 * `document` on the server, it must load once however many callers ask, and it must degrade to
 * "unavailable" rather than throwing when a third-party script is blocked.
 */

const GOOGLE_SRC = 'https://accounts.google.com/gsi/client';

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

	/**
	 * `cookie: false` deliberately: Meta's own cookie would be a second session this app has no
	 * use for. The session is the API's httpOnly cookie and nothing else.
	 */
	it('initialises Meta without its own cookie or XFBML', async () => {
		restore = autoResolveScripts(true);
		const init = [] as Record<string, unknown>[];
		(window as { FB?: unknown }).FB = { init: (o: Record<string, unknown>) => init.push(o), login: () => {} };
		const loader = makeLoader('browser');

		await loader.loadFacebook();

		expect(init).toHaveLength(1);
		expect(init[0]).toMatchObject({ appId: '1234567890', cookie: false, xfbml: false });
	});
});
