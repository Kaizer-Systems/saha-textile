import { Injectable, inject } from '@angular/core';
import { ActivatedRouteSnapshot, Router, RouterStateSnapshot, UrlTree } from '@angular/router';

import { Observable } from 'rxjs';

import { AccountStore } from '@core/state/account.store';

@Injectable({
	providedIn: 'root',
})
export class PermissionGuard {
	private accountStore = inject(AccountStore);
	router = inject(Router);

	canActivate(
		route: ActivatedRouteSnapshot,
		_state: RouterStateSnapshot,
	): Observable<boolean | UrlTree> | Promise<boolean | UrlTree> | boolean | UrlTree {
		const permissions = this.accountStore.permissions()?.map((value) => value?.name);
		const requiredPermission = route.data?.['permission'];

		if (!requiredPermission) {
			return true; // no permission required, allow access
		}

		if (!Array.isArray(requiredPermission) && permissions?.includes(requiredPermission)) {
			return true;
		} else if (
			Array.isArray(requiredPermission) &&
			requiredPermission?.length &&
			requiredPermission.every((action) => permissions?.includes(action))
		) {
			return true;
		} else {
			void this.router.navigate(['/error/403']);
			return false;
		}
	}
}
