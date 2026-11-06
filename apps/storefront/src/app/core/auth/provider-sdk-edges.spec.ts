import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { ProviderSdkLoader } from './provider-sdk.loader';

const config = vi.hoisted(() => ({ googleClientId: 'g', facebookAppId: 'f' }));
vi.mock('@core/config/runtime-config', () => ({ runtimeConfig: config }));

type Win = Window & { google?: unknown; FB?: unknown; fbAsyncInit?: () => void };
const win = window as unknown as Win;

const loader = (platform = 'browser') => {
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({ providers: [{ provide: PLATFORM_ID, useValue: platform }] });
	return TestBed.inject(ProviderSdkLoader);
};
const finishScript = (src: string, event: 'onload' | 'onerror' = 'onload') => {
	const script = document.querySelector<HTMLScriptElement>(`script[src="${src}"]`);
	script?.[event]?.(new Event('x') as never);
};
const GOOGLE = 'https://accounts.google.com/gsi/client';
const FACEBOOK = 'https://connect.facebook.net/en_US/sdk.js';
const settle = async () => {
	for (let i = 0; i < 5; i += 1) await Promise.resolve();
};

afterEach(() => {
	document.querySelectorAll('script[src]').forEach((node) => node.remove());
	delete win.google;
	delete win.FB;
	delete win.fbAsyncInit;
	config.googleClientId = 'g';
});

describe('ProviderSdkLoader edges', () => {
	it('reports whether each provider is configured', () => {
		expect(loader().googleConfigured).toBe(true);
		expect(loader().facebookConfigured).toBe(true);
	});

	it('initialises nothing when Google cannot load', async () => {
		await expect(
			loader('server').initializeGoogle({ client_id: 'g', callback: () => undefined }),
		).resolves.toBeNull();
	});

	it('initialises with a harmless callback before a revoke', async () => {
		const initialize = vi.fn();
		const revoke = vi.fn();
		win.google = { accounts: { id: { initialize, revoke } } };
		const sdk = loader();
		const done = sdk.revokeGoogleGrant('a@b.co');
		await settle();
		finishScript(GOOGLE);
		await done;
		const options = initialize.mock.lastCall?.[0] as { callback: () => unknown };
		expect(options.callback()).toBeUndefined();
	});

	it('reuses a script already on the page, and one script promise per source', async () => {
		const tag = document.createElement('script');
		tag.src = GOOGLE;
		document.head.append(tag);
		win.google = { accounts: { id: { initialize: vi.fn() } } };
		const sdk = loader();
		await expect(sdk.loadGoogle()).resolves.toBe(win.google);
		const shared = sdk as unknown as { loadScript: (src: string) => Promise<boolean> };
		expect(shared.loadScript(GOOGLE)).toBe(shared.loadScript(GOOGLE));
	});

	it('gives up on Facebook when its script fails', async () => {
		const sdk = loader();
		const done = sdk.loadFacebook();
		await settle();
		finishScript(FACEBOOK, 'onerror');
		await expect(done).resolves.toBeNull();
	});

	it('keeps an earlier fbAsyncInit, and reports nothing when Meta installs nothing', async () => {
		const earlier = vi.fn();
		win.fbAsyncInit = earlier;
		const sdk = loader();
		const done = sdk.loadFacebook();
		await settle();
		win.fbAsyncInit?.();
		finishScript(FACEBOOK);
		await expect(done).resolves.toBeNull();
		expect(earlier).toHaveBeenCalledOnce();
	});

	it('reaches the live object through init', async () => {
		const init = vi.fn();
		win.FB = { init, login: vi.fn() };
		const sdk = loader();
		const done = sdk.loadFacebook();
		await settle();
		win.fbAsyncInit?.();
		finishScript(FACEBOOK);
		const api = await done;
		api?.init({ appId: 'x', cookie: false, xfbml: false, version: 'v1' });
		expect(init).toHaveBeenCalledTimes(2);
		delete win.FB;
		expect(() => api?.init({ appId: 'x', cookie: false, xfbml: false, version: 'v1' })).not.toThrow();
	});
});
