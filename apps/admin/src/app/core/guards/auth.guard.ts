import { Injectable, inject } from '@angular/core';
import { CanActivate, CanActivateChild, Router, RouterStateSnapshot, UrlTree } from '@angular/router';

import { AccountStore } from '@core/state/account.store';
import { AuthStore } from '@core/state/auth.store';
import { MenuStore } from '@core/state/menu.store';
import { NavService } from '@data-access/services/nav.service';

/**
 * Route protection for the back office.
 *
 * **Presentation only.** It decides what to render, never what the operator may do: every
 * admin endpoint independently enforces the admin audience, the required role and the
 * required permissions against the session cookie. Bypassing this guard in the browser
 * produces an empty shell and a wall of 401/403 responses, which is exactly what the
 * direct-API bypass tests assert.
 *
 * The check now reads a session resolved from `/auth/admin/me` rather than the removed
 * `localStorage` fake token. An unresolved status counts as not-signed-in; the app
 * initializer resolves the session before routing, so that state is transient.
 */
@Injectable({
	providedIn: 'root',
})
export class AuthGuard implements CanActivate, CanActivateChild {
	private router = inject(Router);
	private navService = inject(NavService);
	private menuStore = inject(MenuStore);
	private accountStore = inject(AccountStore);
	private authStore = inject(AuthStore);

	canActivate(): boolean | UrlTree {
		if (!this.authStore.isAuthenticated()) {
			return this.router.createUrlTree(['/auth/login']);
		}
		this.initializeData();
		return true;
	}

	canActivateChild(_route: unknown, _state: RouterStateSnapshot): boolean | UrlTree {
		// Child routes inherit the parent decision; re-running the shell data load per
		// navigation would fire the same requests again on every click.
		if (!this.authStore.isAuthenticated()) {
			return this.router.createUrlTree(['/auth/login']);
		}
		return true;
	}

	private initializeData(): void {
		this.navService.sidebarLoading = true;
		this.menuStore.loadBadges();
		this.accountStore.loadUserDetails().subscribe({
			complete: () => {
				this.navService.sidebarLoading = false;
			},
			error: () => {
				this.navService.sidebarLoading = false;
			},
		});
	}
}
