import { Injectable, signal } from '@angular/core';

import { of } from 'rxjs';

import type { IAccountUser as AdminAccountUser } from '../../../../../admin/src/app/data-access/interfaces/account.interface';
import type { IAccountUser as StorefrontAccountUser } from '../../../../../storefront/src/app/data-access/interfaces/account.interface';

type StorybookAccountUser = AdminAccountUser & StorefrontAccountUser;

/**
 * Deterministic session boundary for isolated stories. Application components
 * remain real; only the authenticated user transport is replaced.
 */
@Injectable({ providedIn: 'root' })
export class AccountStore {
	readonly user = signal<StorybookAccountUser | null>(null);
	readonly permissions = signal<StorybookAccountUser['permission']>([]);
	readonly roleName = signal<string | null>(null);

	loadUser(): void {}

	loadUserDetails() {
		return of(this.user());
	}

	clear(): void {
		this.user.set(null);
		this.permissions.set([]);
		this.roleName.set(null);
	}

	updateProfile(_payload: unknown): void {}
	updatePassword(_payload: unknown): void {}
	createAddress(_payload: unknown): void {}
	updateAddress(_payload: unknown, _id: number): void {}
	deleteAddress(_id: number): void {}
}
