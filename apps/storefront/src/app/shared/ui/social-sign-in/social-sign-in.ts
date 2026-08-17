import {
	Component,
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
import { firstValueFrom } from 'rxjs';

import { StorefrontAuthGateway, type SocialProvider } from '@core/auth/auth-gateway';
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

/** Everything `connect` needs, gathered by the provider dialog and handed to the parent. */
export interface ProviderCredential {
	provider: SocialProvider;
	stateId: string;
	nonce: string | null;
	credential: string;
}

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
			void this.initGoogle(mount);
		});

		if (this.isBrowser && this.facebookConfigured) void this.initFacebook();
	}

	private async initGoogle(mount: HTMLElement): Promise<void> {
		const state = await this.startState('google');
		if (!state) return;

		const api = await this.loader.loadGoogle();
		if (!api) {
			this.status.set('social_unavailable');
			return;
		}

		api.accounts.id.initialize({
			client_id: runtimeConfig.googleClientId,
			// The nonce the API minted for this attempt. Google returns it inside the signed
			// token, which is what makes a token captured from another session unusable here.
			nonce: state.nonce ?? undefined,
			// One Tap stays OFF until the owner asks for it: it appears without being invoked and
			// would require Google's script on every browsing page to be worth anything.
			auto_select: false,
			cancel_on_tap_outside: true,
			callback: (response) => void this.completeGoogle(state.stateId, state.nonce, response.credential),
		});
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

	private async initFacebook(): Promise<void> {
		const api = await this.loader.loadFacebook();
		this.facebookReady.set(Boolean(api));
		if (!api) this.status.set('social_unavailable');
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

	async signInWithFacebook(): Promise<void> {
		if (this.busy() || !this.facebookReady()) return;
		this.busy.set('facebook');
		this.status.set(null);

		const state = await this.startState('facebook');
		if (!state) {
			this.busy.set(null);
			return;
		}

		const api = await this.loader.loadFacebook();
		if (!api) {
			this.status.set('social_unavailable');
			this.busy.set(null);
			return;
		}

		api.login(
			(response) => {
				const token = response.authResponse?.accessToken;
				if (!token) {
					// Dismissing the popup is an ordinary choice, not an error to shout about.
					this.status.set('social_cancelled');
					this.busy.set(null);
					return;
				}
				void this.complete(this.gateway.verifyFacebook({ stateId: state.stateId, accessToken: token }));
			},
			// Minimum scopes, an owner lock — and it applies to what we ASK for, not only to what
			// we are granted.
			{ scope: 'public_profile,email' },
		);
	}

	private async completeGoogle(stateId: string, nonce: string | null, credential: string): Promise<void> {
		this.busy.set('google');
		if (this.mode() === 'connect') {
			this.emitCredential('google', stateId, nonce, credential);
			return;
		}
		await this.complete(this.gateway.verifyGoogle({ stateId, credential, nonce }));
	}

	/**
	 * Routes on the API's answer.
	 *
	 * A known provider subject signs in; an unknown one continues in the signup form with the
	 * provider's details prefilled. A matching EMAIL produces neither — accounts are never
	 * linked automatically on an address, so that person lands in signup and is told at
	 * verification that an account already exists.
	 */
	private async complete(request: ReturnType<StorefrontAuthGateway['verifyGoogle']>): Promise<void> {
		try {
			const result = await firstValueFrom(request);
			if (result.outcome === 'signed_in' && result.user) {
				await this.authStore.adoptSocialSession(result.user);
				await this.router.navigateByUrl('/');
				return;
			}
			await this.router.navigateByUrl('/auth/register');
		} catch (error) {
			this.status.set(refusalCode(error, 'social_failed'));
		} finally {
			this.busy.set(null);
		}
	}

	/** Hands the credential up. The parent proves freshness and posts it; this stays dumb. */
	private emitCredential(provider: SocialProvider, stateId: string, nonce: string | null, credential: string): void {
		this.busy.set(null);
		this.credential.emit({ provider, stateId, nonce, credential });
	}
}
