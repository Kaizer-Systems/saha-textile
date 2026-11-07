import { PLATFORM_ID, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';

import { from, of, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { StorefrontAuthGateway } from '@core/auth/auth-gateway';
import { ProviderSdkLoader } from '@core/auth/provider-sdk.loader';
import { AuthStore } from '@core/state/auth.store';

import { SocialSignIn } from './social-sign-in';

const config = vi.hoisted(() => ({ googleClientId: 'g-id', facebookAppId: 'f-id', apiUrl: 'https://api.test' }));
vi.mock('@core/config/runtime-config', () => ({ runtimeConfig: config }));

const state = (id: string, minutes = 10) => ({
	stateId: id,
	nonce: `${id}-nonce`,
	expiresAt: new Date(Date.now() + minutes * 60_000).toISOString(),
});
interface Answer {
	authResponse?: { accessToken: string };
}

const render = async (
	options: {
		platform?: string;
		mode?: 'sign-in' | 'connect';
		providers?: string[];
		google?: unknown;
		facebook?: unknown;
		withMount?: boolean;
		states?: () => unknown;
	} = {},
) => {
	let count = 0;
	const renderButton = vi.fn();
	const googleApi = { accounts: { id: { renderButton } } };
	const login = vi.fn();
	const facebookApi = { login };
	const revocations = signal(0);
	let googleCallback: (response: { credential: string }) => void = () => undefined;
	const loader = {
		googleGrantRevocations: revocations,
		initializeGoogle: vi.fn(async (init: { callback: typeof googleCallback }) => {
			googleCallback = init.callback;
			return options.google === undefined ? googleApi : options.google;
		}),
		loadFacebook: vi.fn(async () => (options.facebook === undefined ? facebookApi : options.facebook)),
	};
	const gateway = {
		startOAuth: vi.fn(() => (options.states ? options.states() : of(state(`s${(count += 1)}`)))),
		verifyGoogle: vi.fn(() => of<unknown>({ outcome: 'signed_in', customer: { id: 'c1' } })),
		verifyFacebook: vi.fn(() => of<unknown>({ outcome: 'signed_in', customer: { id: 'c1' } })),
	};
	const store = { adoptSocialSession: vi.fn(async () => undefined) };
	const router = { navigateByUrl: vi.fn(async () => true) };
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{ provide: ProviderSdkLoader, useValue: loader },
			{ provide: StorefrontAuthGateway, useValue: gateway },
			{ provide: AuthStore, useValue: store },
			{ provide: Router, useValue: router },
			{ provide: PLATFORM_ID, useValue: options.platform ?? 'browser' },
		],
	});
	TestBed.overrideComponent(SocialSignIn, {
		set: { imports: [], template: options.withMount === false ? '' : '<div #googleMount></div>' },
	});
	const fixture = TestBed.createComponent(SocialSignIn);
	if (options.mode) fixture.componentRef.setInput('mode', options.mode);
	if (options.providers) fixture.componentRef.setInput('providers', options.providers);
	const social = fixture.componentInstance;
	const seen = { credential: [] as unknown[], signup: 0, existing: [] as string[] };
	social.credential.subscribe((value) => seen.credential.push(value));
	social.signupStarted.subscribe(() => (seen.signup += 1));
	social.existingAccount.subscribe((value) => seen.existing.push(value));
	fixture.detectChanges();
	await settle();
	return {
		fixture,
		social,
		gateway,
		loader,
		store,
		router,
		renderButton,
		login,
		revocations,
		seen,
		press: (credential: string) => googleCallback({ credential }),
	};
};
const settle = async () => {
	for (let i = 0; i < 20; i += 1) await Promise.resolve();
};
const answerFacebook = (parts: Awaited<ReturnType<typeof render>>, answer: Answer) => {
	const callback = parts.login.mock.lastCall?.[0] as (value: Answer) => void;
	callback(answer);
};
const visible = (value: string) => {
	Object.defineProperty(document, 'visibilityState', { configurable: true, value });
	document.dispatchEvent(new Event('visibilitychange'));
};

afterEach(() => {
	config.googleClientId = 'g-id';
	config.facebookAppId = 'f-id';
	vi.useRealTimers();
	Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
});

describe('SocialSignIn arming', () => {
	it('draws Google and arms Facebook', async () => {
		const parts = await render();
		expect(parts.social.googleReady()).toBe(true);
		expect(parts.social.facebookReady()).toBe(true);
		expect(parts.renderButton.mock.calls[0]?.[1]).toMatchObject({ text: 'signin_with', width: 320 });
		expect(parts.loader.initializeGoogle.mock.calls[0]?.[0]).toMatchObject({ nonce: expect.any(String) });
	});

	it('words the button for connecting, and honours the mount width up to the cap', async () => {
		const parts = await render({ mode: 'connect' });
		expect(parts.renderButton.mock.calls[0]?.[1]).toMatchObject({ text: 'continue_with' });
	});

	it('offers only what is configured and asked for', async () => {
		config.googleClientId = '';
		config.facebookAppId = '';
		const none = await render();
		expect(none.social.showGoogle()).toBe(false);
		expect(none.social.showFacebook()).toBe(false);
		expect(none.loader.loadFacebook).not.toHaveBeenCalled();
		config.googleClientId = 'g-id';
		config.facebookAppId = 'f-id';
		const one = await render({ providers: ['google'] });
		expect(one.social.showGoogle()).toBe(true);
		expect(one.social.showFacebook()).toBe(false);
	});

	it('does nothing on the server', async () => {
		const { gateway, social } = await render({ platform: 'server' });
		expect(social.isBrowser).toBe(false);
		expect(gateway.startOAuth).not.toHaveBeenCalled();
	});

	it('waits for a mount before arming Google', async () => {
		const { loader } = await render({ withMount: false });
		expect(loader.initializeGoogle).not.toHaveBeenCalled();
	});

	it('degrades quietly when the state cannot be minted', async () => {
		const { social } = await render({ states: () => throwError(() => new Error('down')) });
		expect(social.status()).toBe('social_unavailable');
		expect(social.googleReady()).toBe(false);
	});

	it('degrades quietly when an SDK will not load', async () => {
		const google = await render({ google: null });
		expect(google.social.status()).toBe('social_unavailable');
		expect(google.social.googleReady()).toBe(false);
		const facebook = await render({ facebook: null });
		expect(facebook.social.status()).toBe('social_unavailable');
		expect(facebook.social.facebookReady()).toBe(false);
	});

	it('sends no nonce it does not have', async () => {
		const { loader } = await render({ states: () => of({ ...state('x'), nonce: null }) });
		expect(loader.initializeGoogle.mock.calls[0]?.[0]).toMatchObject({ nonce: undefined });
	});

	it('stops arming once the screen is gone', async () => {
		let release: (value: unknown) => void = () => undefined;
		const held = new Promise((resolve) => (release = resolve));
		const parts = await render({ providers: ['google'], states: () => from(held) });
		parts.fixture.destroy();
		release(state('late'));
		await settle();
		expect(parts.loader.initializeGoogle).not.toHaveBeenCalled();
	});

	it('stops after the SDK answers late', async () => {
		const parts = await render({ providers: ['google'], withMount: true });
		parts.loader.initializeGoogle.mockImplementation(async () => {
			parts.fixture.destroy();
			return { accounts: { id: { renderButton: parts.renderButton } } };
		});
		const calls = parts.renderButton.mock.calls.length;
		parts.gateway.verifyGoogle.mockReturnValue(throwError(() => ({ error: { code: 'nope' } })));
		parts.press('token');
		await settle();
		expect(parts.renderButton.mock.calls.length).toBe(calls);
	});

	it('stops arming Facebook once the screen is gone', async () => {
		let release: (value: unknown) => void = () => undefined;
		const parts = await render({ providers: [] });
		parts.loader.loadFacebook.mockImplementation(() => new Promise((resolve) => (release = resolve)) as never);
		parts.fixture.componentRef.setInput('providers', ['facebook']);
		parts.fixture.detectChanges();
		await settle();
		parts.fixture.destroy();
		release({ login: vi.fn() });
		await settle();
		expect(parts.social.facebookReady()).toBe(false);
	});
});

describe('SocialSignIn redraw and refresh', () => {
	it('redraws when a grant revocation lands, only after it is ready', async () => {
		const parts = await render();
		const calls = parts.renderButton.mock.calls.length;
		parts.revocations.set(1);
		TestBed.tick();
		expect(parts.renderButton.mock.calls.length).toBe(calls + 1);
	});

	it('ignores a revocation before the button exists', async () => {
		const parts = await render({ google: null });
		parts.revocations.set(1);
		TestBed.tick();
		expect(parts.renderButton).not.toHaveBeenCalled();
	});

	it('refreshes stale states when the tab returns', async () => {
		let minutes = 1;
		const parts = await render({ states: () => of(state('s', minutes)) });
		const before = parts.gateway.startOAuth.mock.calls.length;
		minutes = 10;
		visible('visible');
		await settle();
		expect(parts.gateway.startOAuth.mock.calls.length).toBe(before + 2);
	});

	it('leaves fresh states alone, and ignores the tab hiding', async () => {
		const parts = await render();
		const before = parts.gateway.startOAuth.mock.calls.length;
		visible('visible');
		visible('hidden');
		await settle();
		expect(parts.gateway.startOAuth.mock.calls.length).toBe(before);
	});

	it('treats a missing Facebook state as stale, and skips providers not ready', async () => {
		const parts = await render({ providers: ['facebook'], states: () => throwError(() => new Error('down')) });
		parts.gateway.startOAuth.mockReturnValue(of(state('later')) as never);
		visible('visible');
		await settle();
		expect(parts.gateway.startOAuth).toHaveBeenCalledWith('facebook');
		parts.social.signInWithFacebook();
		expect(parts.login).toHaveBeenCalledOnce();
	});

	it('stops listening when destroyed', async () => {
		const parts = await render();
		parts.fixture.destroy();
		const before = parts.gateway.startOAuth.mock.calls.length;
		visible('visible');
		await settle();
		expect(parts.gateway.startOAuth.mock.calls.length).toBe(before);
	});
});

describe('SocialSignIn Google answers', () => {
	it('signs an existing customer in and goes home, without re-arming', async () => {
		const parts = await render({ providers: ['google'] });
		const before = parts.gateway.startOAuth.mock.calls.length;
		parts.press('token');
		await settle();
		expect(parts.gateway.verifyGoogle).toHaveBeenCalledWith({
			stateId: 's1',
			credential: 'token',
			nonce: 's1-nonce',
		});
		expect(parts.store.adoptSocialSession).toHaveBeenCalledWith({ id: 'c1' });
		expect(parts.router.navigateByUrl).toHaveBeenCalledWith('/');
		expect(parts.gateway.startOAuth.mock.calls.length).toBe(before);
		expect(parts.social.busy()).toBeNull();
	});

	it('continues to signup for a new account', async () => {
		const parts = await render({ providers: ['google'] });
		parts.gateway.verifyGoogle.mockReturnValue(of({ outcome: 'signup_started' }));
		parts.press('token');
		await settle();
		expect(parts.seen.signup).toBe(1);
		expect(parts.router.navigateByUrl).toHaveBeenCalledWith('/auth/register');
	});

	it('continues to signup when "signed in" carries no customer', async () => {
		const parts = await render({ providers: ['google'] });
		parts.gateway.verifyGoogle.mockReturnValue(of({ outcome: 'signed_in' }));
		parts.press('token');
		await settle();
		expect(parts.seen.signup).toBe(1);
	});

	it('offers a code for an address that already has an account, and re-arms', async () => {
		const parts = await render({ providers: ['google'] });
		parts.gateway.verifyGoogle.mockReturnValue(of({ outcome: 'account_exists', existingAccountEmail: 'a@b.co' }));
		const before = parts.gateway.startOAuth.mock.calls.length;
		parts.press('token');
		await settle();
		expect(parts.seen.existing).toEqual(['a@b.co']);
		expect(parts.gateway.startOAuth.mock.calls.length).toBe(before + 1);
	});

	it('goes to signup when the account_exists answer has no address', async () => {
		const parts = await render({ providers: ['google'] });
		parts.gateway.verifyGoogle.mockReturnValue(of({ outcome: 'account_exists' }));
		parts.press('token');
		await settle();
		expect(parts.seen.signup).toBe(1);
	});

	it('names an expired state and any other refusal', async () => {
		const parts = await render({ providers: ['google'] });
		parts.gateway.verifyGoogle.mockReturnValue(throwError(() => ({ error: { code: 'oauth_state_invalid' } })));
		parts.press('token');
		await settle();
		expect(parts.social.status()).toBe('social_state_expired');
		parts.gateway.verifyGoogle.mockReturnValue(throwError(() => new Error('down')));
		parts.press('token');
		await settle();
		expect(parts.social.status()).toBe('social_failed');
	});

	it('hands the credential up in connect mode without calling verify', async () => {
		const parts = await render({ mode: 'connect', providers: ['google'] });
		parts.press('token');
		await settle();
		expect(parts.gateway.verifyGoogle).not.toHaveBeenCalled();
		expect(parts.seen.credential).toEqual([
			{ provider: 'google', stateId: 's1', nonce: 's1-nonce', credential: 'token' },
		]);
	});
});

describe('SocialSignIn Google edges', () => {
	it('ignores an answer before anything was armed', async () => {
		const parts = await render({ google: null, providers: ['google'] });
		parts.press('token');
		await settle();
		expect(parts.gateway.verifyGoogle).not.toHaveBeenCalled();
	});

	it('does not re-arm once the screen is gone', async () => {
		const parts = await render({ mode: 'connect', providers: ['google'] });
		const before = parts.gateway.startOAuth.mock.calls.length;
		parts.fixture.destroy();
		parts.press('token');
		await settle();
		expect(parts.gateway.startOAuth.mock.calls.length).toBe(before);
	});
});

describe('SocialSignIn Facebook', () => {
	it('refuses a second press while busy', async () => {
		const parts = await render({ providers: ['facebook'] });
		parts.social.busy.set('google');
		parts.social.signInWithFacebook();
		expect(parts.login).not.toHaveBeenCalled();
	});

	it('says so and arms when pressed too early', async () => {
		const parts = await render({ facebook: null, providers: ['facebook'] });
		parts.loader.loadFacebook.mockResolvedValue({ login: parts.login });
		parts.social.signInWithFacebook();
		expect(parts.social.status()).toBe('social_unavailable');
		await settle();
		expect(parts.social.facebookReady()).toBe(true);
	});

	it('signs in with the access token', async () => {
		const parts = await render({ providers: ['facebook'] });
		parts.social.signInWithFacebook();
		expect(parts.social.busy()).toBe('facebook');
		expect(parts.login.mock.lastCall?.[1]).toEqual({ scope: 'public_profile,email' });
		answerFacebook(parts, { authResponse: { accessToken: 'fb' } });
		await settle();
		expect(parts.gateway.verifyFacebook).toHaveBeenCalledWith({ stateId: expect.any(String), accessToken: 'fb' });
		expect(parts.router.navigateByUrl).toHaveBeenCalledWith('/');
	});

	it('re-arms when the sign-in did not navigate', async () => {
		const parts = await render({ providers: ['facebook'] });
		parts.gateway.verifyFacebook.mockReturnValue(throwError(() => new Error('down')));
		parts.social.signInWithFacebook();
		const before = parts.gateway.startOAuth.mock.calls.length;
		answerFacebook(parts, { authResponse: { accessToken: 'fb' } });
		await settle();
		expect(parts.gateway.startOAuth.mock.calls.length).toBe(before + 1);
	});

	it('hands the credential up in connect mode, with no nonce', async () => {
		const parts = await render({ mode: 'connect', providers: ['facebook'] });
		parts.social.signInWithFacebook();
		answerFacebook(parts, { authResponse: { accessToken: 'fb' } });
		await settle();
		expect(parts.seen.credential).toEqual([
			{ provider: 'facebook', stateId: expect.any(String), nonce: null, credential: 'fb' },
		]);
	});

	it('treats a closed dialog as a choice and re-arms', async () => {
		const parts = await render({ providers: ['facebook'] });
		parts.social.signInWithFacebook();
		answerFacebook(parts, {});
		await settle();
		expect(parts.social.status()).toBe('social_cancelled');
		expect(parts.social.busy()).toBeNull();
	});

	it('recovers when the SDK throws', async () => {
		const parts = await render({ providers: ['facebook'] });
		parts.login.mockImplementation(() => {
			throw new Error('blocked');
		});
		parts.social.signInWithFacebook();
		expect(parts.social.status()).toBe('social_unavailable');
		expect(parts.social.busy()).toBeNull();
	});

	it('releases the button when Meta never answers', async () => {
		const parts = await render({ providers: ['facebook'] });
		vi.useFakeTimers();
		parts.social.signInWithFacebook();
		vi.advanceTimersByTime(90_000);
		expect(parts.social.status()).toBe('social_cancelled');
		expect(parts.social.busy()).toBeNull();
	});

	it('leaves a finished press alone when the timer fires', async () => {
		const parts = await render({ providers: ['facebook'] });
		vi.useFakeTimers();
		parts.social.signInWithFacebook();
		parts.social.busy.set(null);
		vi.advanceTimersByTime(90_000);
		expect(parts.social.status()).toBeNull();
	});

	it('restarts the timer for a repeat press', async () => {
		const parts = await render({ providers: ['facebook'] });
		vi.useFakeTimers();
		parts.social.signInWithFacebook();
		parts.social.busy.set(null);
		parts.social.signInWithFacebook();
		vi.advanceTimersByTime(89_000);
		expect(parts.social.busy()).toBe('facebook');
		answerFacebook(parts, {});
		expect(parts.social.status()).toBe('social_cancelled');
	});
});
