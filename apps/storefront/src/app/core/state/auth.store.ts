import { computed, inject } from '@angular/core';
import { Router } from '@angular/router';

import { patchState, signalStore, withComputed, withMethods, withState } from '@ngrx/signals';
import { firstValueFrom } from 'rxjs';

import { type AuthUser, StorefrontAuthGateway } from '@core/auth/auth-gateway';

import { AccountStore } from './account.store';

/**
 * Storefront session facade.
 *
 * ## What changed and why
 *
 * This store previously seeded a hard-coded `FAKE_ACCESS_TOKEN` in `onInit` so the app
 * rendered as signed-in with no backend involved. That is removed. Two separate problems
 * it caused:
 *
 * 1. **It lied.** `isAuthenticated` was true before anyone authenticated, so guards,
 *    account pages and the header all displayed a session that did not exist. Any bug in
 *    real authorization would have been invisible behind it.
 * 2. **It trained the wrong shape.** A token held in client state implies the client
 *    forwards a credential. The locked model is the opposite: the API sets `httpOnly`
 *    cookies the browser cannot read, and the client holds no credential at all.
 *
 * So this store now holds only **sanitized identity plus a resolution status**, and every
 * transition comes from a real API response through {@link StorefrontAuthGateway}. The
 * status is three-valued on purpose: `unknown` (bootstrap has not answered yet) must not
 * be confused with `anonymous` (the API said no), or a guard would bounce a signed-in
 * customer to the login page during hydration.
 *
 * Nothing here is persisted to `localStorage`, `sessionStorage` or IndexedDB. The session
 * survives a reload because the cookie does, and `bootstrap()` re-reads it from `/me`.
 */
export type SessionStatus = 'unknown' | 'anonymous' | 'authenticated';

interface AuthStateModel {
	status: SessionStatus;
	user: AuthUser | null;
	/** Transloco key for the last failure, cleared on the next attempt. Never a raw sentence. */
	error: string | null;
	pending: boolean;
}

const INITIAL: AuthStateModel = { status: 'unknown', user: null, error: null, pending: false };

/**
 * Failure states are Transloco KEYS, not sentences.
 *
 * Two reasons. Developer-owned UI chrome is Machine-1 content and must be translated
 * reactively rather than carried as literal English through TypeScript. And the API
 * answers login, registration and recovery generically so responses cannot be used to
 * discover which addresses are registered — surfacing a server-supplied message would risk
 * handing that signal back, so each action resolves to one fixed key instead.
 */
const ERROR_KEYS = {
	credentials: 'sign_in_failed',
	registration: 'registration_failed',
	generic: 'something_went_wrong_please_try_again',
	otpCode: 'invalid_or_expired_code',
	resetToken: 'invalid_or_expired_reset_link',
} as const;

export const AuthStore = signalStore(
	{ providedIn: 'root' },
	withState<AuthStateModel>(INITIAL),
	withComputed((store) => ({
		isAuthenticated: computed(() => store.status() === 'authenticated'),
		/** True only while the session is genuinely undetermined — never after a real answer. */
		isResolving: computed(() => store.status() === 'unknown'),
		email: computed(() => store.user()?.email ?? ''),
	})),
	withMethods(
		(
			store,
			gateway = inject(StorefrontAuthGateway),
			accountStore = inject(AccountStore),
			router = inject(Router),
		) => {
			function applySession(user: AuthUser): void {
				patchState(store, { status: 'authenticated', user, error: null, pending: false });
			}

			function applyAnonymous(error: string | null = null): void {
				patchState(store, { status: 'anonymous', user: null, error, pending: false });
			}

			return {
				/**
				 * Resolves the session from cookies once per app load. Also fetches the CSRF
				 * token, because every later state-changing request has to echo it.
				 */
				async bootstrap(): Promise<void> {
					const user = await firstValueFrom(gateway.currentUser());
					if (user) {
						applySession(user);
						accountStore.loadUser();
					} else {
						applyAnonymous();
					}
					try {
						await firstValueFrom(gateway.ensureCsrfToken());
					} catch {
						// A missing CSRF token must not block rendering; the first unsafe
						// request will fail closed and surface it, which is the safe order.
					}
				},

				async loginWithPassword(input: {
					identifier: string;
					password: string;
					rememberMe?: boolean;
				}): Promise<boolean> {
					patchState(store, { pending: true, error: null });
					try {
						const result = await firstValueFrom(gateway.loginWithPassword(input));
						applySession(result.user);
						accountStore.loadUser();
						await firstValueFrom(gateway.ensureCsrfToken());
						return true;
					} catch {
						applyAnonymous(ERROR_KEYS.credentials);
						return false;
					}
				},

				/**
				 * Completes a signup that the SERVER already verified.
				 *
				 * Takes only a password, and only when the signup began with one — the social
				 * paths set one later from the account page. There are no identifiers here
				 * because there are none in the request: the API finalises from the values it
				 * proved, so nothing the form holds can be substituted at the moment an
				 * account is minted.
				 */
				async finaliseSignup(password?: string): Promise<boolean> {
					patchState(store, { pending: true, error: null });
					try {
						const result = await firstValueFrom(gateway.finaliseSignup(password));
						applySession(result.user);
						accountStore.loadUser();
						await firstValueFrom(gateway.ensureCsrfToken());
						return true;
					} catch {
						// Covers every refusal the flow can end on — an expired pending record, an
						// identifier that turned out to be taken, a conflict between two proven
						// identifiers. The screen reads the stable code; the store only needs to
						// know it did not become a session.
						applyAnonymous(ERROR_KEYS.registration);
						return false;
					}
				},

				/**
				 * Adopts a session minted by a verified provider token.
				 *
				 * The social routes may sign an EXISTING customer in, so the store has to be
				 * told about a session it did not create through a credential form.
				 */
				async adoptSocialSession(user: AuthUser): Promise<void> {
					applySession(user);
					accountStore.loadUser();
					await firstValueFrom(gateway.ensureCsrfToken());
				},

				/** Always resolves true — the API's answer is generic by design. */
				async requestLoginOtp(identifier: string, purpose: 'login' | 'register' = 'login'): Promise<boolean> {
					patchState(store, { pending: true, error: null });
					try {
						await firstValueFrom(gateway.requestLoginOtp(identifier, purpose));
						patchState(store, { pending: false });
						return true;
					} catch {
						patchState(store, { pending: false, error: ERROR_KEYS.generic });
						return false;
					}
				},

				async verifyLoginOtp(input: {
					identifier: string;
					code: string;
					rememberMe?: boolean;
				}): Promise<boolean> {
					patchState(store, { pending: true, error: null });
					try {
						const result = await firstValueFrom(gateway.verifyLoginOtp(input));
						applySession(result.user);
						accountStore.loadUser();
						await firstValueFrom(gateway.ensureCsrfToken());
						return true;
					} catch {
						applyAnonymous(ERROR_KEYS.otpCode);
						return false;
					}
				},

				/** Generic by design: success never confirms the identifier is registered. */
				async requestPasswordReset(identifier: string): Promise<boolean> {
					patchState(store, { pending: true, error: null });
					try {
						await firstValueFrom(gateway.requestPasswordReset(identifier));
						patchState(store, { pending: false });
						return true;
					} catch {
						patchState(store, { pending: false, error: ERROR_KEYS.generic });
						return false;
					}
				},

				async resetPassword(input: { token: string; newPassword: string }): Promise<boolean> {
					patchState(store, { pending: true, error: null });
					try {
						await firstValueFrom(gateway.resetPassword(input));
						// The API revoked every session for this account, including any this
						// browser held, so the local state must follow rather than linger.
						applyAnonymous();
						return true;
					} catch {
						patchState(store, { pending: false, error: ERROR_KEYS.resetToken });
						return false;
					}
				},

				async activateAccount(input: { token: string; newPassword: string }): Promise<boolean> {
					patchState(store, { pending: true, error: null });
					try {
						await firstValueFrom(gateway.activateAccount(input));
						applyAnonymous();
						return true;
					} catch {
						patchState(store, { pending: false, error: ERROR_KEYS.resetToken });
						return false;
					}
				},

				async logout(): Promise<void> {
					try {
						await firstValueFrom(gateway.logout());
					} catch {
						// Swallowed deliberately. `finally` alone would still reject, and every
						// caller is a click handler that has nothing useful to do with the
						// error — the local clear below is the part that matters to the user.
					} finally {
						// Clear locally even if the call failed: leaving the UI signed-in after
						// the user asked to leave is the worse outcome on a shared device.
						applyAnonymous();
						accountStore.clear();
						void router.navigate(['/auth/login']);
					}
				},

				/** Drops local session state after the API reports the session is gone (401). */
				authClear(): void {
					applyAnonymous();
					accountStore.clear();
				},

				clearError(): void {
					patchState(store, { error: null });
				},
			};
		},
	),
);
