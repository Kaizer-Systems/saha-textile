import { Injectable, inject } from '@angular/core';
import { UrlTree, Router, ActivatedRouteSnapshot, RouterStateSnapshot } from '@angular/router';

import { Observable } from 'rxjs';

import { AccountStore } from '@core/state/account.store';
import { AuthStore } from '@core/state/auth.store';
import { AuthService } from '@data-access/services/auth.service';

@Injectable({
	providedIn: 'root',
})
export class AuthGuard {
	private router = inject(Router);
	private authService = inject(AuthService);
	private authStore = inject(AuthStore);
	private accountStore = inject(AccountStore);

	canActivate(
		route: ActivatedRouteSnapshot,
		state: RouterStateSnapshot,
	): Observable<boolean | UrlTree> | Promise<boolean | UrlTree> | boolean | UrlTree {
		// Store the attempted URL for redirecting after login
		this.authService.redirectUrl = state.url;

		// Redirect to the login page
		if (!this.authStore.access_token()) {
			return this.router.createUrlTree(['/auth/login']);
		}

		this.accountStore.loadUser();
		return true;
	}

	canActivateChild(_route: ActivatedRouteSnapshot, _state: RouterStateSnapshot): boolean | UrlTree {
		if (!!this.authStore.access_token()) {
			if (
				this.router.url.startsWith('/account') ||
				this.router.url == '/checkout' ||
				this.router.url == '/compare'
			)
				void this.router.navigate(['/']);
			return false;
		}
		return true;
	}
}
