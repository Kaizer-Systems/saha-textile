import { Injectable, inject } from '@angular/core';
import { ActivatedRouteSnapshot, Router, RouterStateSnapshot, UrlTree } from '@angular/router';

import { Observable } from 'rxjs';

import { AuthStore } from '@core/state/auth.store';

@Injectable({
	providedIn: 'root',
})
export class PermissionGuard {
	private authStore = inject(AuthStore);
	router = inject(Router);

	canActivate(
		route: ActivatedRouteSnapshot,
		_state: RouterStateSnapshot,
	): Observable<boolean | UrlTree> | Promise<boolean | UrlTree> | boolean | UrlTree {
		const permissions = this.authStore.permissions();
		const requiredPermission = route.data?.['permission'];

		if (!requiredPermission) {
			return true;
		}

		if (!Array.isArray(requiredPermission) && permissions.includes(requiredPermission)) {
			return true;
		}
		if (
			Array.isArray(requiredPermission) &&
			requiredPermission.length &&
			requiredPermission.every((action: string) => permissions.includes(action))
		) {
			return true;
		}
		void this.router.navigate(['/error/403']);
		return false;
	}
}
