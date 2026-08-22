import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';

import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { StorefrontAuthGateway } from '@core/auth/auth-gateway';
import { ProviderSdkLoader } from '@core/auth/provider-sdk.loader';
import { runtimeConfig } from '@core/config/runtime-config';
import { AuthStore } from '@core/state/auth.store';

import { SocialSignIn, type ProviderCredential } from './social-sign-in';

/**
 * Which of the two modes a provider dialog's answer ends up in.
 *
 * `connect` must never reach the verify endpoints. Facebook's path used to do exactly that: the
 * mode check lived only in Google's, so connecting Meta from the account screen ran the sign-in
 * flow — navigating away on a linked subject, and opening a SIGNUP on an unlinked one, which is
 * the case connecting actually is. `credential` never fired, so Facebook could not be attached at
 * all, and nothing failed loudly enough to notice.
 *
 * So both providers are asserted against the same four questions, and the Facebook half is the
 * regression. The template is replaced with a minimal stand-in: what is under test is where an
 * answer goes, not the markup or its translations, and Google's real button cannot be rendered in
 * jsdom anyway.
 */

/** Far enough out that the refresh margin is not tripped by the clock. */
const FRESH = () => new Date(Date.now() + 10 * 60_000).toISOString();
const NEARLY_EXPIRED = () => new Date(Date.now() + 30_000).toISOString();
const GOOGLE_ID_TOKEN = 'google.id.token';
const FACEBOOK_ACCESS_TOKEN = 'facebook-access-token';

/**
 * The real template renders Google's own button and runs every string through Transloco, neither
 * of which survives jsdom or says anything about where an answer goes. `#googleMount` is kept —
 * and kept behind `showGoogle()`, as in the real template — because the component's `effect`
 * waits for it before arming Google, and a mount that appeared unconditionally would arm Google
 * in a Facebook-only case and shift every minted-state index by one.
 */
const TEMPLATE_STAND_IN = '@if (showGoogle()) { <div #googleMount></div> }';

interface Harness {
	component: SocialSignIn;
	emitted: ProviderCredential[];
	verifyGoogle: ReturnType<typeof vi.fn>;
	verifyFacebook: ReturnType<typeof vi.fn>;
	navigate: ReturnType<typeof vi.fn>;
	adopt: ReturnType<typeof vi.fn>;
	/** Fires Google's callback the way the SDK would, once `initialize` has captured it. */
	fireGoogle: (idToken: string) => void;
	/** Every state the component has asked the API to mint, oldest first. */
	minted: string[];
	/** The nonce Google was most recently armed with. */
	armedNonce: () => string | undefined;
	/** How many times Meta's `login` was actually reached. */
	facebookLoginCalls: number;
	/** How many times Google's SDK was initialised — one per armed nonce, and no more. */
	initializeCalls: () => number;
}

function harness(
	mode: 'sign-in' | 'connect',
	providers: Array<'google' | 'facebook'>,
	options: {
		expiresAt?: () => string;
		verifyGoogleFails?: unknown;
		silentFacebook?: boolean;
		startStateFails?: boolean;
		/** Verify resolves to a signup rather than a session, which keeps the card on screen. */
		signupRequired?: boolean;
	} = {},
): Harness {
	let googleCallback: ((response: { credential: string }) => void) | null = null;
	let armedNonce: string | undefined;
	let minted = 0;
	let initializeCalls = 0;

	const result = {
		emitted: [],
		verifyGoogle: vi.fn(() =>
			of(
				options.signupRequired
					? { outcome: 'signup_required', user: null, session: null, pendingSignup: null }
					: { outcome: 'signed_in', user: { id: 'cus_1' }, session: null, pendingSignup: null },
			),
		),
		verifyFacebook: vi.fn(() =>
			of({ outcome: 'signed_in', user: { id: 'cus_1' }, session: null, pendingSignup: null }),
		),
		navigate: vi.fn().mockResolvedValue(true),
		adopt: vi.fn().mockResolvedValue(undefined),
		fireGoogle: (idToken: string) => googleCallback?.({ credential: idToken }),
		minted: [] as string[],
		armedNonce: () => armedNonce,
		facebookLoginCalls: 0,
		initializeCalls: () => initializeCalls,
	} as unknown as Harness;

	const googleApi = {
		accounts: {
			id: {
				initialize: (config: { callback: (response: { credential: string }) => void; nonce?: string }) => {
					initializeCalls += 1;
					googleCallback = config.callback;
					armedNonce = config.nonce;
				},
				renderButton: () => undefined,
				revoke: () => undefined,
			},
		},
	};

	const loader = {
		loadGoogle: async () => googleApi,
		// Mirrors the real service: configure, then hand the API back. The component goes through
		// this rather than calling `initialize` itself, so the loader knows GIS is configured and
		// `revokeGoogleGrant` does not have to guess.
		initializeGoogle: async (config: Parameters<typeof googleApi.accounts.id.initialize>[0]) => {
			googleApi.accounts.id.initialize(config);
			return googleApi;
		},
		// Meta's SDK hands the token to a callback; invoking it synchronously is the whole dialog.
		// `silentFacebook` models the popup the browser refused to open: `login` is reached, and
		// nothing ever comes back.
		loadFacebook: async () => ({
			login: (callback: (response: { authResponse?: { accessToken: string } }) => void) => {
				result.facebookLoginCalls += 1;
				if (options.silentFacebook) return;
				callback({ authResponse: { accessToken: FACEBOOK_ACCESS_TOKEN } });
			},
		}),
	};

	const gateway = {
		startOAuth: () => {
			if (options.startStateFails) return throwError(() => new Error('state mint refused'));
			minted += 1;
			const state = {
				stateId: `oas_${minted}`,
				nonce: `non_${minted}`,
				expiresAt: (options.expiresAt ?? FRESH)(),
			};
			result.minted.push(state.stateId);
			return of(state);
		},
		verifyGoogle: options.verifyGoogleFails
			? vi.fn(() => throwError(() => options.verifyGoogleFails))
			: result.verifyGoogle,
		verifyFacebook: result.verifyFacebook,
	};

	if (options.verifyGoogleFails) result.verifyGoogle = gateway.verifyGoogle as never;

	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		imports: [SocialSignIn],
		providers: [
			{ provide: ProviderSdkLoader, useValue: loader },
			{ provide: StorefrontAuthGateway, useValue: gateway },
			{ provide: AuthStore, useValue: { adoptSocialSession: result.adopt } },
			{ provide: Router, useValue: { navigateByUrl: result.navigate } },
		],
	});
	TestBed.overrideComponent(SocialSignIn, { set: { template: TEMPLATE_STAND_IN } });

	const fixture = TestBed.createComponent(SocialSignIn);
	fixture.componentRef.setInput('mode', mode);
	fixture.componentRef.setInput('providers', providers);
	fixture.detectChanges();

	result.component = fixture.componentInstance;
	result.component.credential.subscribe((value) => result.emitted.push(value));
	return result;
}

/**
 * The state a provider was armed with.
 *
 * BOTH providers now arm once at initialisation — Facebook too, because its dialog is a popup
 * that only opens inside the click, leaving no room to fetch anything first. In a
 * single-provider harness that makes the first minted state the one the click will use.
 */
const armedState = (h: Harness) => h.minted[0];

/** Lets the SDK stubs' promise chain settle before the assertions read the outcome. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
	runtimeConfig.googleClientId = 'test-google-client-id';
	runtimeConfig.facebookAppId = 'test-facebook-app-id';
});

describe('connect mode hands the credential up and calls nothing', () => {
	it('for Facebook — the path that used to sign the person in instead', async () => {
		const h = harness('connect', ['facebook']);
		await settle();

		h.component.signInWithFacebook();
		await settle();

		expect(h.emitted).toEqual([
			{ provider: 'facebook', stateId: armedState(h), nonce: null, credential: FACEBOOK_ACCESS_TOKEN },
		]);
		expect(h.verifyFacebook).not.toHaveBeenCalled();
		expect(h.navigate).not.toHaveBeenCalled();
		expect(h.adopt).not.toHaveBeenCalled();
	});

	it('for Google', async () => {
		const h = harness('connect', ['google']);
		await settle();

		h.fireGoogle(GOOGLE_ID_TOKEN);
		await settle();

		expect(h.emitted).toEqual([
			// `non_1`, not whatever is armed now: by this point the component has already replaced
			// the spent state, which is the behaviour the re-arm cases below pin down.
			{ provider: 'google', stateId: armedState(h), nonce: 'non_1', credential: GOOGLE_ID_TOKEN },
		]);
		expect(h.verifyGoogle).not.toHaveBeenCalled();
		expect(h.navigate).not.toHaveBeenCalled();
	});
});

describe('sign-in mode verifies and routes', () => {
	it('for Facebook', async () => {
		const h = harness('sign-in', ['facebook']);
		await settle();

		h.component.signInWithFacebook();
		await settle();

		expect(h.verifyFacebook).toHaveBeenCalledWith({
			stateId: armedState(h),
			accessToken: FACEBOOK_ACCESS_TOKEN,
		});
		expect(h.emitted).toEqual([]);
		expect(h.navigate).toHaveBeenCalledWith('/');
	});

	it('for Google, carrying the nonce the API minted', async () => {
		const h = harness('sign-in', ['google']);
		await settle();

		h.fireGoogle(GOOGLE_ID_TOKEN);
		await settle();

		expect(h.verifyGoogle).toHaveBeenCalledWith({
			stateId: armedState(h),
			credential: GOOGLE_ID_TOKEN,
			nonce: 'non_1',
		});
		expect(h.emitted).toEqual([]);
	});

	/** An unknown subject continues in the signup form — sign-in only, never from connect. */
	it('routes an unrecognised provider account into signup', async () => {
		const h = harness('sign-in', ['facebook']);
		h.verifyFacebook.mockReturnValue(
			of({ outcome: 'signup_required', user: null, session: null, pendingSignup: null }),
		);
		await settle();

		h.component.signInWithFacebook();
		await settle();

		expect(h.navigate).toHaveBeenCalledWith('/auth/register');
	});
});

describe('the Facebook button cannot strand', () => {
	/**
	 * The bug a real browser found and no fake could. `login` used to be called after two awaits
	 * — one for the state, one for the SDK — which ends the user gesture, so Chrome refused to
	 * open Meta's popup. Nothing happened at all, and the button sat greyed out reading
	 * "Signing in…" until the page was reloaded.
	 *
	 * Asserting on ORDER is what pins it: everything the click needs must already be in hand
	 * before the click, so no state is minted between pressing and the dialog opening.
	 */
	it('mints nothing at click time — the state was already armed', async () => {
		const h = harness('sign-in', ['facebook']);
		await settle();
		const beforeClick = h.minted.length;

		h.component.signInWithFacebook();

		// Synchronously after the press: the SDK has been reached, with no round trip in between.
		expect(h.facebookLoginCalls).toBe(1);
		expect(h.minted).toHaveLength(beforeClick);
	});

	it('releases the button when Meta never calls back', async () => {
		vi.useFakeTimers();
		try {
			const h = harness('sign-in', ['facebook'], { silentFacebook: true });
			await vi.advanceTimersByTimeAsync(0);

			h.component.signInWithFacebook();
			expect(h.component.busy()).toBe('facebook');

			await vi.advanceTimersByTimeAsync(90_000);

			expect(h.component.busy()).toBeNull();
			expect(h.component.status()).toBe('social_cancelled');
		} finally {
			vi.useRealTimers();
		}
	});

	/**
	 * A spent state is replaced when the person is STILL looking at this button.
	 *
	 * Both of the outcomes that succeed — a session, or a signup to continue in — navigate, so
	 * the card is gone and there is nothing to arm. A REFUSAL is the case that leaves them on it,
	 * and the next press must have a fresh state to spend or it meets `oauth_state_invalid` until
	 * the page is reloaded, which is not a diagnosis anybody could be expected to reach.
	 */
	it('replaces the state it spent when a refusal left the person on the card', async () => {
		const h = harness('sign-in', ['facebook']);
		h.verifyFacebook.mockReturnValue(throwError(() => new Error('nope')));
		await settle();
		const before = h.minted.length;

		h.component.signInWithFacebook();
		await settle();

		expect(h.minted.length).toBeGreaterThan(before);
	});

	/** The other half of that rule: a sign-in that navigated away mints nothing for nobody. */
	it('mints no replacement after a sign-in that navigated away', async () => {
		const h = harness('sign-in', ['facebook']);
		await settle();
		const before = h.minted.length;

		h.component.signInWithFacebook();
		await settle();

		expect(h.navigate).toHaveBeenCalledWith('/');
		expect(h.minted).toHaveLength(before);
	});

	it('says so and re-arms rather than doing nothing when it was never armed', async () => {
		const h = harness('sign-in', ['facebook'], { silentFacebook: true });
		await settle();
		// Whatever the reason, an unarmed button must explain itself rather than sit inert.
		(h.component as unknown as { facebookState: unknown }).facebookState = null;

		h.component.signInWithFacebook();

		expect(h.component.busy()).toBeNull();
		expect(h.component.status()).toBe('social_unavailable');
	});
});

describe("Google's state does not go stale on the page", () => {
	/**
	 * A state is single-use. Minting once at component init gave a button that worked at most
	 * once: any second press — after a cancelled dialog, a refused token, or a signup that
	 * returned the person to the same card — met `oauth_state_invalid` until a page reload.
	 */
	it('replaces the state it just spent, with a new nonce', async () => {
		const h = harness('sign-in', ['google'], { verifyGoogleFails: new Error('nope') });
		await settle();
		expect(h.minted).toHaveLength(1);

		h.fireGoogle(GOOGLE_ID_TOKEN);
		await settle();

		expect(h.minted.length).toBeGreaterThan(1);
		// The nonce is what makes the state single-use from Google's side, so a re-arm that
		// reused it would look like a re-arm and behave like the bug it was fixing.
		expect(h.armedNonce()).toBe('non_2');
	});

	/**
	 * The counterpart, and the reason `initialize() is called multiple times` was in the console.
	 *
	 * A fresh state means a fresh nonce, and the nonce is an argument to `initialize()` — so
	 * re-arming necessarily initialises Google's SDK again. Doing it after a sign-in that has
	 * already navigated away spends a state and reconfigures a global for a button nobody is
	 * looking at, and Google says so in the log every time.
	 */
	it('does not re-initialise after a sign-in that navigated away', async () => {
		const h = harness('sign-in', ['google']);
		await settle();
		expect(h.initializeCalls()).toBe(1);

		h.fireGoogle(GOOGLE_ID_TOKEN);
		await settle();

		expect(h.navigate).toHaveBeenCalledWith('/');
		expect(h.minted).toHaveLength(1);
		expect(h.initializeCalls()).toBe(1);
	});

	/** The tab-left-open case: ten minutes pass, the person returns and presses the button. */
	it('replaces a nearly-expired state when the tab becomes visible again', async () => {
		const h = harness('sign-in', ['google'], { expiresAt: NEARLY_EXPIRED });
		await settle();
		const before = h.minted.length;

		document.dispatchEvent(new Event('visibilitychange'));
		await settle();

		expect(h.minted.length).toBeGreaterThan(before);
	});

	it('leaves a fresh state alone when the tab becomes visible', async () => {
		const h = harness('sign-in', ['google']);
		await settle();
		const before = h.minted.length;

		document.dispatchEvent(new Event('visibilitychange'));
		await settle();

		expect(h.minted).toHaveLength(before);
	});

	/** The safety net: whatever slipped through, the person is told to try rather than stuck. */
	it('reports an expired state as something a retry can fix', async () => {
		const refusal = { error: { error: { issues: [{ code: 'oauth_state_invalid' }] } } };
		const h = harness('sign-in', ['google'], { verifyGoogleFails: refusal });
		await settle();

		h.fireGoogle(GOOGLE_ID_TOKEN);
		await settle();

		expect(h.component.status()).toBe('social_state_expired');
	});
});

describe('degrading stays quiet', () => {
	/**
	 * The state is minted while ARMING, so a refusal there is what leaves the button unarmed.
	 * Pressing it must then say so and try again in the background — never emit, never navigate,
	 * and never sit inert.
	 */
	it('reports a refused state mint without emitting or navigating', async () => {
		const h = harness('connect', ['facebook'], { startStateFails: true });
		await settle();

		h.component.signInWithFacebook();
		await settle();

		expect(h.emitted).toEqual([]);
		expect(h.verifyFacebook).not.toHaveBeenCalled();
		expect(h.component.status()).toBe('social_unavailable');
	});
});
