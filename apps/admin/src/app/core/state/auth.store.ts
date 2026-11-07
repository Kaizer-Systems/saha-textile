import { computed, inject } from '@angular/core';
import { Router } from '@angular/router';

import { patchState, signalStore, withComputed, withMethods, withState } from '@ngrx/signals';
import { firstValueFrom } from 'rxjs';

import { AdminAuthGateway, type AdminUser } from '@core/auth/auth-gateway';

/**
 * Admin session facade.
 *
 * ## What changed and why
 *
 * This store used to keep a hard-coded `FAKE_TOKEN` **and persist the whole state to
 * `localStorage`**, which made it the worst of the two applications:
 *
 * 1. `isAuthenticated` was true before anyone signed in, so the entire back office
 *    rendered without authentication.
 * 2. A credential-shaped value was written to browser storage, where any script on the
 *    page can read it. Even a fake one teaches the wrong pattern, and the security
 *    baseline is explicit: no auth token in `localStorage`, `sessionStorage`, IndexedDB,
 *    URLs, analytics or logs.
 *
 * Both are gone. There is **no persistence hook in this store at all** — the session lives
 * in `httpOnly` cookies the browser cannot read, and `bootstrap()` re-reads it from
 * `/auth/admin/me` after a reload.
 *
 * `permissions` is held here for UI shaping only. It is server-authoritative and re-checked
 * on every request, so hiding a menu item is convenience; the API is what actually refuses.
 */
export type AdminSessionStatus = 'unknown' | 'anonymous' | 'authenticated';

interface AuthStateModel {
	status: AdminSessionStatus;
	user: AdminUser | null;
	permissions: string[];
	/** Transloco key for the last failure, cleared on the next attempt. Never a raw sentence. */
	error: string | null;
	pending: boolean;
}

const INITIAL: AuthStateModel = { status: 'unknown', user: null, permissions: [], error: null, pending: false };

/**
 * Failure states are Transloco keys, and one shared message covers password and PIN alike.
 *
 * That is not laziness: the API answers wrong password, wrong PIN, unknown identifier and
 * customer-role account identically, so the endpoint cannot be used to discover which
 * accounts exist or which login method is configured. A per-case message here would hand
 * that distinction straight back.
 *
 * The PIN lock is the one case an operator genuinely needs told apart — they must know
 * password login still works, or they are simply stuck. The API cannot express it yet: the
 * controller throws a specific message, but the global error filter replaces every 401 with
 * the generic `unauthorized` envelope, so nothing distinguishing survives the boundary.
 * Rather than guess from a status code, the hint below is shown alongside every credential
 * failure, and the missing stable sub-code is tracked for the admin pass.
 */
const ERROR_KEYS = {
	credentials: 'invalid_credentials',
	generic: 'something_went_wrong_please_try_again',
	resetToken: 'invalid_or_expired_reset_link',
} as const;

export const AuthStore = signalStore(
	{ providedIn: 'root' },
	withState<AuthStateModel>(INITIAL),
	withComputed((store) => ({
		isAuthenticated: computed(() => store.status() === 'authenticated'),
		isResolving: computed(() => store.status() === 'unknown'),
		email: computed(() => store.user()?.email ?? ''),
		/** Drives the login screen's default tab; never a policy decision. */
		preferredLoginMethod: computed(() => store.user()?.preferredLoginMethod ?? 'password'),
	})),
	withMethods((store, gateway = inject(AdminAuthGateway), router = inject(Router)) => {
		function applyAnonymous(error: string | null = null): void {
			patchState(store, { status: 'anonymous', user: null, permissions: [], error, pending: false });
		}

		async function loadSession(): Promise<boolean> {
			const me = await firstValueFrom(gateway.currentUser());
			if (!me) {
				applyAnonymous();
				return false;
			}
			patchState(store, {
				status: 'authenticated',
				user: me.user,
				permissions: me.permissions,
				error: null,
				pending: false,
			});
			return true;
		}

		async function resumeWithProof(prove: () => Promise<unknown>): Promise<boolean> {
			patchState(store, { pending: true, error: null });
			try {
				try {
					await firstValueFrom(gateway.refreshSession());
				} catch {
					applyAnonymous();
					return false;
				}
				await prove();
				// Re-read /me: role/permissions may have changed while the overlay was up.
				return await loadSession();
			} catch {
				// Wrong PIN/password — session may still be live after the refresh above.
				if (store.status() === 'authenticated') {
					patchState(store, { pending: false, error: ERROR_KEYS.credentials });
				} else {
					applyAnonymous(ERROR_KEYS.credentials);
				}
				return false;
			}
		}

		return {
			/** Resolves the admin session from cookies once per app load. */
			async bootstrap(): Promise<void> {
				await loadSession();
				try {
					await firstValueFrom(gateway.ensureCsrfToken());
				} catch {
					// A missing CSRF token must not block rendering; the first unsafe
					// request fails closed and surfaces it, which is the safe order.
				}
			},

			async loginWithPassword(input: { identifier: string; password: string }): Promise<boolean> {
				patchState(store, { pending: true, error: null });
				try {
					await firstValueFrom(gateway.loginWithPassword(input));
					await firstValueFrom(gateway.ensureCsrfToken());
					// Re-read /me rather than trusting the login body: permissions and PIN
					// state come from the server, and this is the shape the rest of the app
					// consumes anyway.
					return await loadSession();
				} catch {
					applyAnonymous(ERROR_KEYS.credentials);
					return false;
				}
			},

			async loginWithPin(input: { identifier: string; pin: string }): Promise<boolean> {
				patchState(store, { pending: true, error: null });
				try {
					await firstValueFrom(gateway.loginWithPin(input));
					await firstValueFrom(gateway.ensureCsrfToken());
					return await loadSession();
				} catch {
					applyAnonymous(ERROR_KEYS.credentials);
					return false;
				}
			},

			/**
			 * Quick-resume after the idle soft lock. Refreshes the CURRENT session rather
			 * than creating one, so the mounted route and unsaved form state survive.
			 *
			 * A prior cookie rotation is intentional: soft-lock can outlast the access JWT
			 * while the server idle window is still live; resume still needs a principal.
			 * Rotation alone does not unlock the UI — PIN/password does.
			 */
			async resumeWithPin(pin: string): Promise<boolean> {
				return resumeWithProof(() => firstValueFrom(gateway.resumeWithPin(pin)));
			},

			async resumeWithPassword(password: string): Promise<boolean> {
				return resumeWithProof(() => firstValueFrom(gateway.resumeWithPassword(password)));
			},

			/**
			 * Starts recovery. Resolves true whether or not the account exists — the API's
			 * answer is generic by design, and branching here would rebuild the
			 * enumeration oracle it removes.
			 */
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
					// The server revoked every admin session and suspended PIN use, so this
					// browser is signed out by definition; local state must follow rather
					// than linger and look authenticated.
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
				} finally {
					// Clear locally even if the call failed: leaving a back office looking
					// signed-in after the operator asked to leave is the worse outcome.
					applyAnonymous();
					void router.navigate(['/auth/login']);
				}
			},

			/** Drops local session state after the API reports the session is gone (401). */
			clear(): void {
				applyAnonymous();
			},

			clearError(): void {
				patchState(store, { error: null });
			},
		};
	}),
);
