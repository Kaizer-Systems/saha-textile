import { Injectable, inject } from '@angular/core';
import { UrlTree, Router, ActivatedRouteSnapshot, RouterStateSnapshot } from '@angular/router';

import { AuthStore } from '@core/state/auth.store';
import { AuthService } from '@data-access/services/auth.service';

/**
 * Route protection for customer account areas.
 *
 * This is **usability, not security**. It decides what to render; it decides nothing about
 * what the caller may read. Every protected API response is authorized server-side against
 * the session cookie and the resource's owner, so bypassing this guard in the browser
 * yields an empty shell and a wall of 401/404 responses rather than data.
 *
 * The check now reads a session resolved from `/me` instead of the removed fake token, and
 * the account profile load moved to the session bootstrap — a guard that fired a request as
 * a side effect ran it again on every navigation.
 *
 * An unresolved status (`unknown`) counts as not-signed-in: the app initializer resolves the
 * session before routing in the browser, so `unknown` here means server-side rendering,
 * where the anonymous view is the correct and safe output.
 */
@Injectable({
	providedIn: 'root',
})
export class AuthGuard {
	private router = inject(Router);
	private authService = inject(AuthService);
	private authStore = inject(AuthStore);

	canActivate(_route: ActivatedRouteSnapshot, state: RouterStateSnapshot): boolean | UrlTree {
		if (this.authStore.isAuthenticated()) return true;

		// Remember where they were headed so login can return them there. This is the
		// router's own internal URL — never an arbitrary absolute address, which is what
		// turns a post-login redirect into an open redirect.
		this.authService.redirectUrl = state.url;
		return this.router.createUrlTree(['/auth/login']);
	}

	/** Keeps an already-authenticated customer out of the guest-only auth screens. */
	canActivateChild(_route: ActivatedRouteSnapshot, _state: RouterStateSnapshot): boolean | UrlTree {
		if (this.authStore.isAuthenticated()) {
			return this.router.createUrlTree(['/account/dashboard']);
		}
		return true;
	}
}
