import {
	Component,
	DestroyRef,
	ElementRef,
	PLATFORM_ID,
	computed,
	effect,
	inject,
	input,
	output,
	signal,
	viewChild,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Router } from '@angular/router';

import { TranslocoModule } from '@jsverse/transloco';
import { Observable, firstValueFrom } from 'rxjs';

import { StorefrontAuthGateway, type OAuthVerifyResult, type SocialProvider } from '@core/auth/auth-gateway';
import { ProviderSdkLoader } from '@core/auth/provider-sdk.loader';
import { refusalCode } from '@core/auth/refusal-code';
import { runtimeConfig } from '@core/config/runtime-config';
import { AuthStore } from '@core/state/auth.store';

/**
 * The Google and Facebook buttons, shared by the login and registration cards.
 *
 * ## The buttons are the providers' own
 *
 * `google.accounts.id.renderButton()` draws Google's button, and Meta's SDK drives the
 * Facebook one. We supply no logo, no colours and no button text — both companies require
 * their own branding, and a hand-drawn imitation is both a policy breach and an invitation to
 * drift out of date. The only copy this component owns is its status line.
 *
 * ## Nothing here is trusted
 *
 * The SDKs hand back a credential; the API decides what it means. A verified token either
 * signs an existing customer in or begins a signup — this component just routes on the
 * answer. It never reads a profile out of the SDK, because a page can put anything in a
 * JavaScript object.
 *
 * ## Two modes, one set of plumbing
 *
 * `sign-in` opens a session and routes on the answer. `connect` does NOT call the API at all —
 * it emits the credential and lets the parent decide, because attaching a provider to an
 * existing account needs step-up proof the parent has to collect first.
 *
 * That decision is made in ONE place, `completeProviderResult`, for every provider. It used to
 * live in Google's path alone, and Facebook's path — written separately — simply did not have it:
 * connecting Meta from the account screen ran the sign-in flow, which navigated away or opened a
 * signup, and never emitted anything, so Facebook could not be attached at all. A rule that each
 * provider re-implements is a rule one of them will be missing.
 *
 * The proof is asked for AFTER the provider dialog rather than before, now that the buttons are
 * the providers' own: Google's button owns its click, so there is no moment to interrupt in
 * between. Holding the credential in memory for the few seconds that takes adds no exposure —
 * it arrived in memory from the SDK — and the API refuses a connect without proof regardless.
 *
 * ## Degrading is normal, not exceptional
 *
 * Unconfigured provider, blocked script, ad-blocker, popup dismissed, CSP refusal — each
 * resolves to a quiet state with password and OTP untouched. A social button that cannot load
 * must never be able to break sign-in.
 */
/** Google's own maximum for a rendered button; asking for more is silently ignored. */
const GOOGLE_BUTTON_MAX_WIDTH = 400;

/**
 * How close to expiry a minted state may get before it is replaced ahead of the next click.
 *
 * The server gives a state ten minutes. Two of them is enough slack for a click, a provider
 * dialog and a round trip, without re-minting so eagerly that an open tab keeps writing rows.
 */
const GOOGLE_STATE_REFRESH_MARGIN_MS = 2 * 60_000;

/**
 * How long to wait for Meta's callback before releasing the button.
 *
 * Generous on purpose — signing in to Facebook can involve a password, a second factor and a
 * consent screen — but bounded, because a button that never recovers is worse than one that gives
 * up too early and says so.
 */
const FACEBOOK_CALLBACK_TIMEOUT_MS = 90_000;

/** Everything `connect` needs, gathered by the provider dialog and handed to the parent. */
export interface ProviderCredential {
	provider: SocialProvider;
	stateId: string;
	nonce: string | null;
	credential: string;
}

/**
 * What a provider dialog handed back, named for what it actually is.
 *
 * A discriminated union rather than a shared `credential: string`, because the two are different
 * artefacts: Google returns a signed ID token that carries the nonce back for the API to compare,
 * and Meta returns a bearer access token with no nonce concept at all. A single parameter meaning
 * "whichever one of those" is precisely how one provider's handling drifts away from the other's.
 *
 * The WIRE flattens them again — `ConnectIdentityRequest.credential` is documented as "Google ID
 * token or Facebook access token, per provider" — so the distinction is kept here, where it is
 * real, and dropped at the one boundary that has already declared it does not care.
 */
type ProviderResult =
	| { provider: 'google'; stateId: string; nonce: string | null; idToken: string }
	| { provider: 'facebook'; stateId: string; accessToken: string };

@Component({
	selector: 'app-social-sign-in',
	templateUrl: './social-sign-in.html',
	imports: [TranslocoModule],
})
export class SocialSignIn {
	private readonly platformId = inject<Object>(PLATFORM_ID);
	private readonly loader = inject(ProviderSdkLoader);
	private readonly gateway = inject(StorefrontAuthGateway);
	private readonly authStore = inject(AuthStore);
	private readonly router = inject(Router);

	private readonly googleMount = viewChild<ElementRef<HTMLElement>>('googleMount');

	/** `sign-in` starts a session; `connect` hands the credential to the parent instead. */
	readonly mode = input<'sign-in' | 'connect'>('sign-in');
	/** Which providers to offer. Connect screens hide one that is already attached. */
	readonly providers = input<SocialProvider[]>(['google', 'facebook']);
	/** Emitted in `connect` mode only: everything the connect endpoint needs, minus the proof. */
	readonly credential = output<ProviderCredential>();

	readonly isBrowser = isPlatformBrowser(this.platformId);
	readonly googleReady = signal(false);
	readonly facebookReady = signal(false);
	readonly busy = signal<SocialProvider | null>(null);
	/** Translated key for the status line, or null when there is nothing to say. */
	readonly status = signal<string | null>(null);

	/**
	 * The state Google's button is currently armed with, and where it is drawn.
	 *
	 * Held on the instance rather than captured in the callback closure: re-arming replaces this,
	 * and the callback reads it at CLICK time, so a stale id cannot be sent even if Google were to
	 * keep an older callback registered.
	 */
	private googleState: { stateId: string; nonce: string | null; expiresAt: string } | null = null;
	private googleMountElement: HTMLElement | null = null;

	/**
	 * Facebook's SDK and state, both resolved BEFORE the click.
	 *
	 * Meta's dialog is a popup, and a browser only allows one to open inside a user gesture. The
	 * click handler therefore cannot await anything: everything it needs has to be sitting here
	 * already. See `signInWithFacebook`.
	 */
	private facebookApi: Awaited<ReturnType<ProviderSdkLoader['loadFacebook']>> = null;
	private facebookState: { stateId: string; nonce: string | null; expiresAt: string } | null = null;
	/** Clears the busy state if Meta's callback never arrives, so the button cannot strand. */
	private facebookWatchdog: ReturnType<typeof setTimeout> | null = null;
	/** Guards the arming effect, which re-runs whenever the inputs it reads change. */
	private facebookArming = false;
	/**
	 * Set on teardown so an in-flight arm cannot come back and touch a dead component.
	 *
	 * Both arming paths `await` the API, so either can resolve after the screen has moved on.
	 * Re-initialising Google's SDK from a component nobody is looking at is exactly the kind of
	 * stray call that produced `initialize() is called multiple times`.
	 */
	private destroyed = false;

	/** Configuration is read synchronously so the template can decide what to render at all. */
	readonly googleConfigured = Boolean(runtimeConfig.googleClientId);
	readonly facebookConfigured = Boolean(runtimeConfig.facebookAppId);

	/** Configured AND asked for — a connect screen hides a provider already attached. */
	readonly showGoogle = computed(() => this.googleConfigured && this.providers().includes('google'));
	readonly showFacebook = computed(() => this.facebookConfigured && this.providers().includes('facebook'));

	constructor() {
		// An effect rather than `ngOnInit`: Google's button needs its mount element to exist, and
		// `viewChild` only resolves after the first render.
		effect(() => {
			const mount = this.googleMount()?.nativeElement;
			if (!this.isBrowser || !mount || this.googleReady()) return;
			void this.armGoogle(mount);
		});

		/**
		 * Facebook arms once, and only when it is actually OFFERED.
		 *
		 * In an effect rather than the constructor because `showFacebook()` reads the `providers`
		 * input, which Angular has not applied yet while the constructor runs — arming on
		 * `facebookConfigured` alone minted a state for a button the screen was never going to
		 * show, which on the account screen is one wasted state per page load.
		 */
		effect(() => {
			if (!this.isBrowser || !this.showFacebook() || this.facebookArming) return;
			this.facebookArming = true;
			void this.armFacebook();
		});

		/**
		 * A tab left open outlives its state. Refreshing when it comes back into view covers the
		 * ordinary version of that — someone opens the sign-in page, goes away, returns and clicks
		 * — without a timer that would keep minting states for a tab nobody is looking at.
		 */
		if (this.isBrowser) {
			const onVisible = () => {
				if (document.visibilityState !== 'visible') return;
				if (this.googleReady() && this.googleStateIsStale()) void this.rearmGoogle();
				if (this.facebookReady() && this.facebookStateIsStale()) void this.armFacebook();
			};
			document.addEventListener('visibilitychange', onVisible);
			inject(DestroyRef).onDestroy(() => {
				this.destroyed = true;
				document.removeEventListener('visibilitychange', onVisible);
				this.clearFacebookWatchdog();
			});
		}
	}

	/**
	 * Mints a state and arms Google's button with it. Safe to run again.
	 *
	 * Google's ID token carries the nonce, and Google signs it at CLICK time — so the nonce, and
	 * therefore the state, has to exist before the button is pressed. That is why this cannot mint
	 * on demand the way the Facebook path does, and why the state has to be kept fresh instead.
	 *
	 * The callback reads `this.googleState` rather than the value captured here, so whatever is
	 * currently armed is what gets sent.
	 */
	private async armGoogle(mount: HTMLElement): Promise<void> {
		const state = await this.startState('google');
		if (!state) return;

		// Two awaits stand between the caller and here; the screen may have moved on across
		// either. `initialize()` is global state, so configuring it for a component that no
		// longer exists would reconfigure the SDK for whatever is on screen now.
		if (this.destroyed) return;

		// Through the loader rather than on the API directly, so the service that owns this
		// global knows it has been configured — `revokeGoogleGrant` is refused before the first
		// `initialize()`, and it runs on a screen that never renders this button.
		const api = await this.loader.initializeGoogle({
			client_id: runtimeConfig.googleClientId,
			// The nonce the API minted for this attempt. Google returns it inside the signed
			// token, which is what makes a token captured from another session unusable here.
			nonce: state.nonce ?? undefined,
			// One Tap stays OFF until the owner asks for it: it appears without being invoked and
			// would require Google's script on every browsing page to be worth anything.
			auto_select: false,
			cancel_on_tap_outside: true,
			callback: (response) => void this.onGoogleCredential(response.credential),
		});
		if (!api) {
			this.status.set('social_unavailable');
			return;
		}
		if (this.destroyed) return;

		this.googleState = state;
		this.googleMountElement = mount;

		api.accounts.id.renderButton(mount, {
			theme: 'outline',
			size: 'large',
			// `continue_with` on the account screen: "Sign in with Google" would be wrong wording
			// for somebody already signed in who is attaching a provider. These are the only
			// labels Google offers — the text is theirs to control, not ours to write.
			text: this.mode() === 'connect' ? 'continue_with' : 'signin_with',
			// Google refuses anything above 400 anyway; asking for the container width in a wider
			// card left their button short of Meta's. Both are capped to the same ceiling.
			width: Math.min(mount.clientWidth || 320, GOOGLE_BUTTON_MAX_WIDTH),
		});
		this.googleReady.set(true);
	}

	/**
	 * Handles Google's answer, then re-arms — because the state it just used is now spent.
	 *
	 * A state is single-use AND time-limited: the server consumes it on the first verify and
	 * refuses anything past ten minutes. Minting once at component init therefore gave a button
	 * that worked at most once, and only if it was pressed in time. A second attempt after any
	 * outcome — a cancelled dialog, a refused token, a signup that returned the person to the same
	 * card — met `oauth_state_invalid` until the page was reloaded, which is not a diagnosis
	 * anybody could be expected to reach.
	 */
	private async onGoogleCredential(idToken: string): Promise<void> {
		const state = this.googleState;
		if (!state) return;

		const navigated = await this.completeProviderResult({
			provider: 'google',
			stateId: state.stateId,
			nonce: state.nonce,
			idToken,
		});

		/**
		 * Re-arm only when the person is STILL LOOKING AT THIS BUTTON.
		 *
		 * A fresh state means a fresh nonce, and the nonce is an argument to
		 * `google.accounts.id.initialize()` — so re-arming necessarily initialises the SDK
		 * again, and Google logs `initialize() is called multiple times` when it does. That was
		 * happening after every attempt, including the successful ones that navigate straight
		 * off the page: an entire second initialisation, a warning, and a minted state, all for
		 * a button that no longer exists.
		 *
		 * Skipping it where nothing needs arming leaves exactly one `initialize()` on the path
		 * everybody takes. The failure paths still re-arm, because there the button is about to
		 * be pressed again and its state is spent — and there the second call is not spurious.
		 */
		if (!navigated) await this.rearmGoogle();
	}

	/** Replaces a spent or nearly-expired state, if the button is still on screen. */
	private async rearmGoogle(): Promise<void> {
		const mount = this.googleMountElement;
		if (!this.isBrowser || this.destroyed || !mount) return;
		await this.armGoogle(mount);
	}

	/** True when the armed state is gone, spent, or too close to expiry to trust with a click. */
	private googleStateIsStale(): boolean {
		const state = this.googleState;
		if (!state) return true;
		return Date.parse(state.expiresAt) - Date.now() <= GOOGLE_STATE_REFRESH_MARGIN_MS;
	}

	/**
	 * Loads Meta's SDK and mints a state, so that clicking can be instantaneous.
	 *
	 * Both were previously fetched INSIDE the click handler. Each `await` there ended the user
	 * gesture, and by the time `FB.login()` ran the browser refused to open its popup — so
	 * nothing happened at all: no dialog, no error, and a button left greyed out reading
	 * "Signing in…" until the page was reloaded, having silently spent a state on the way.
	 *
	 * Google never had this because Google's own button owns its click. Arming ahead of time is
	 * how the Facebook path gets the same property.
	 */
	private async armFacebook(): Promise<void> {
		const api = await this.loader.loadFacebook();
		if (this.destroyed) return;
		this.facebookApi = api;
		this.facebookReady.set(Boolean(api));
		if (!api) {
			this.status.set('social_unavailable');
			return;
		}

		const state = await this.startState('facebook');
		if (state) this.facebookState = state;
	}

	/** True when Facebook's armed state is gone or too close to expiry to trust with a click. */
	private facebookStateIsStale(): boolean {
		const state = this.facebookState;
		if (!state) return true;
		return Date.parse(state.expiresAt) - Date.now() <= GOOGLE_STATE_REFRESH_MARGIN_MS;
	}

	/** Mints the state a round-trip is bound to, or reports the provider unavailable. */
	private async startState(provider: SocialProvider) {
		try {
			return await firstValueFrom(this.gateway.startOAuth(provider));
		} catch {
			this.status.set('social_unavailable');
			return null;
		}
	}

	/**
	 * Opens Meta's dialog. SYNCHRONOUS, and that is the whole point.
	 *
	 * A browser only permits a popup inside the user gesture that asked for it. Every `await`
	 * before `login()` ends that gesture, so this method must not contain one — the SDK and the
	 * state are armed in advance precisely so there is nothing left to wait for here.
	 *
	 * Not armed yet is treated as a degraded provider rather than a dead button: it says so, and
	 * arms in the background so the next press works.
	 */
	signInWithFacebook(): void {
		if (this.busy() !== null) return;

		const api = this.facebookApi;
		const state = this.facebookState;
		if (!api || !state) {
			this.status.set('social_unavailable');
			void this.armFacebook();
			return;
		}

		this.busy.set('facebook');
		this.status.set(null);
		this.startFacebookWatchdog();

		/**
		 * Guarded because `login` reaches a third-party global we do not control. A throw here
		 * would leave the button disabled reading "Signing in…" with the watchdog as the only
		 * way out, which is ninety seconds of nothing for a failure we already know about.
		 */
		try {
			api.login(
				(response) => this.onFacebookCredential(response.authResponse?.accessToken ?? null),
				// Minimum scopes, an owner lock — and it applies to what we ASK for, not only to
				// what we are granted.
				{ scope: 'public_profile,email' },
			);
		} catch {
			this.clearFacebookWatchdog();
			this.busy.set(null);
			this.status.set('social_unavailable');
			void this.armFacebook();
		}
	}

	/**
	 * Meta's answer, or the absence of one.
	 *
	 * The state is spent either way, so it is replaced either way — a second press must not meet
	 * `oauth_state_invalid` the way Google's used to.
	 */
	private onFacebookCredential(accessToken: string | null): void {
		this.clearFacebookWatchdog();

		if (!accessToken) {
			// Dismissing the dialog is an ordinary choice, not an error to shout about.
			this.status.set('social_cancelled');
			this.busy.set(null);
			void this.armFacebook();
			return;
		}

		const state = this.facebookState;
		if (!state) {
			this.status.set('social_unavailable');
			this.busy.set(null);
			return;
		}

		void this.completeProviderResult({
			provider: 'facebook',
			stateId: state.stateId,
			accessToken,
		}).then((navigated) => {
			// Same rule as Google's: a spent state only needs replacing if this button is still
			// on screen to press. Meta has no `initialize()` to call twice, but a state minted
			// for a destroyed component is a row written for nobody either way.
			if (!navigated) void this.armFacebook();
		});
	}

	/**
	 * The button must never be left greyed out.
	 *
	 * Meta's SDK is trusted to call back, and mostly does — but a dialog the browser refuses to
	 * open, or a popup closed in a way the SDK does not report, leaves it silent. Without this the
	 * button sits disabled reading "Signing in…" with no explanation until the page is reloaded,
	 * which is precisely the "a social button must never break sign-in" promise this component
	 * makes at the top of the file.
	 *
	 * Long enough not to interrupt somebody genuinely typing a Meta password, short enough that a
	 * dead press does not outlast the person's patience.
	 */
	private startFacebookWatchdog(): void {
		this.clearFacebookWatchdog();
		this.facebookWatchdog = setTimeout(() => {
			this.facebookWatchdog = null;
			if (this.busy() !== 'facebook') return;
			this.busy.set(null);
			this.status.set('social_cancelled');
			void this.armFacebook();
		}, FACEBOOK_CALLBACK_TIMEOUT_MS);
	}

	private clearFacebookWatchdog(): void {
		if (this.facebookWatchdog === null) return;
		clearTimeout(this.facebookWatchdog);
		this.facebookWatchdog = null;
	}

	/**
	 * The ONE place a provider result becomes either a session or an emitted credential.
	 *
	 * Shared by every provider deliberately. `connect` must never reach the verify endpoints: it
	 * signs the person in, or routes them into signup, in a screen whose entire purpose is to
	 * attach a provider to the account they are already using. Keeping the check here means a
	 * provider added later inherits it instead of having to remember it.
	 */
	private async completeProviderResult(result: ProviderResult): Promise<boolean> {
		this.busy.set(result.provider);

		if (this.mode() === 'connect') {
			this.emitCredential(result);
			return false;
		}

		return this.complete(
			result.provider === 'google'
				? this.gateway.verifyGoogle({
						stateId: result.stateId,
						credential: result.idToken,
						nonce: result.nonce,
					})
				: this.gateway.verifyFacebook({ stateId: result.stateId, accessToken: result.accessToken }),
		);
	}

	/**
	 * Routes on the API's answer.
	 *
	 * A known provider subject signs in; an unknown one continues in the signup form with the
	 * provider's details prefilled. A matching EMAIL produces neither — accounts are never
	 * linked automatically on an address, so that person lands in signup and is told at
	 * verification that an account already exists.
	 */
	private async complete(request: Observable<OAuthVerifyResult>): Promise<boolean> {
		try {
			const result = await firstValueFrom(request);
			if (result.outcome === 'signed_in' && result.user) {
				await this.authStore.adoptSocialSession(result.user);
				await this.router.navigateByUrl('/');
				return true;
			}
			/**
			 * The signup form asks the API for this record itself, through
			 * `GET /auth/storefront/signup`, so `result.pendingSignup` is deliberately not
			 * carried across the navigation. The server keyed it to the `st_signup` cookie, and
			 * reading it back is what makes the form survive a refresh — a value handed through
			 * router state would be gone the moment anybody pressed F5.
			 */
			await this.router.navigateByUrl('/auth/register');
			return true;
		} catch (error) {
			const code = refusalCode(error, 'social_failed');
			/**
			 * The safety net behind the re-arming above. Whatever slipped through — a suspended
			 * laptop, a clock adrift, a state consumed by a request whose answer never arrived —
			 * the recovery is the same: get a fresh state and say so, rather than leaving a button
			 * that will refuse every further press until the page is reloaded.
			 */
			this.status.set(code === 'oauth_state_invalid' ? 'social_state_expired' : code);
			return false;
		} finally {
			this.busy.set(null);
		}
	}

	/**
	 * Hands the credential up in the wire's own shape. The parent proves freshness and posts it.
	 *
	 * This is where the union collapses to `ConnectIdentityRequest`'s single `credential` field —
	 * the one place the two token kinds genuinely stop mattering, because the contract says so.
	 */
	private emitCredential(result: ProviderResult): void {
		this.busy.set(null);
		this.credential.emit({
			provider: result.provider,
			stateId: result.stateId,
			// Meta has no nonce concept, so there is nothing to carry rather than something lost.
			nonce: result.provider === 'google' ? result.nonce : null,
			credential: result.provider === 'google' ? result.idToken : result.accessToken,
		});
	}
}
