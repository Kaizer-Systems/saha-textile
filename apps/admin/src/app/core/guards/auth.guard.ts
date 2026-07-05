import { Injectable, inject } from '@angular/core';
import { CanActivate, CanActivateChild, Router, UrlTree } from '@angular/router';

import { AccountStore } from '@core/state/account.store';
import { AuthStore } from '@core/state/auth.store';
import { MenuStore } from '@core/state/menu.store';
import { NavService } from '@data-access/services/nav.service';

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
		if (this.authStore.isAuthenticated()) {
			this.initializeData();
			return true;
		}
		return this.router.createUrlTree(['/auth/login']);
	}

	canActivateChild(): boolean {
		return true;
	}

	private initializeData(): void {
		this.navService.sidebarLoading = true;
		this.menuStore.loadBadges();
		this.accountStore.loadUserDetails().subscribe({
			complete: () => {
				this.navService.sidebarLoading = false;
			},
		});
	}
}
