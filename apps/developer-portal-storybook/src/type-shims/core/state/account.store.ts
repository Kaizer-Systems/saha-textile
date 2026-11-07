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

	adoptUser(user: AdminAccountUser | StorefrontAccountUser): void {
		this.user.set(user as StorybookAccountUser);
	}

	async updateProfile(_displayName: string): Promise<boolean> {
		return true;
	}

	async createAddress(_payload: unknown): Promise<boolean> {
		return true;
	}

	async updateAddress(_addressId: string, _address: unknown): Promise<boolean> {
		return true;
	}

	async deleteAddress(_addressId: string): Promise<boolean> {
		return true;
	}
}
