import { Injectable, inject } from '@angular/core';
import { CanActivate, CanActivateChild, Router, UrlTree } from '@angular/router';

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
 * The check reads a session resolved from `/auth/admin/me`. Menu ACL uses AuthStore
 * permissions — mock `account.json` is not loaded here.
 */
@Injectable({
	providedIn: 'root',
})
export class AuthGuard implements CanActivate, CanActivateChild {
	private router = inject(Router);
	private navService = inject(NavService);
	private menuStore = inject(MenuStore);
	private authStore = inject(AuthStore);

	canActivate(): boolean | UrlTree {
		if (!this.authStore.isAuthenticated()) {
			return this.router.createUrlTree(['/auth/login']);
		}
		this.initializeData();
		return true;
	}

	canActivateChild(): boolean | UrlTree {
		if (!this.authStore.isAuthenticated()) {
			return this.router.createUrlTree(['/auth/login']);
		}
		return true;
	}

	private initializeData(): void {
		this.navService.sidebarLoading = true;
		this.menuStore.loadBadges();
		// Permissions already live on AuthStore from bootstrap/`/me` — no mock account fetch.
		this.navService.sidebarLoading = false;
	}
}
