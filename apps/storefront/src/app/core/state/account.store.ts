import { inject } from '@angular/core';

import { patchState, signalStore, withMethods, withState } from '@ngrx/signals';
import { rxMethod } from '@ngrx/signals/rxjs-interop';
import { EMPTY, Observable, catchError, firstValueFrom, pipe, switchMap, tap } from 'rxjs';

import { IAccountUser } from '@data-access/interfaces/account.interface';
import { IUserAddress } from '@data-access/interfaces/user.interface';
import { AccountAddressService } from '@data-access/services/account-address.service';
import { AccountService } from '@data-access/services/account.service';
import { ICustomerAddress } from '@data-access/interfaces/customer.interface';

/**
 * User account/session (replaces NGXS AccountState + its actions). `user` is a
 * server read (loadUser); the profile/password/address mutations were no-op
 * stubs with no backend and stay as hook points for future API wiring.
 */
/**
 * No `permissions` here, deliberately.
 *
 * The store used to hold `permissions: result.permission`, but the fixture it reads has no
 * `permission` key at all — only a `role` whose own `permission` is not an array — so the list
 * was always empty. Nothing in the storefront ever read it either: a sweep for permission gating
 * across every page, guard and template found no element or route conditioned on one.
 *
 * That is the correct shape rather than an omission. Permissions are OPERATOR vocabulary; they
 * arrived with the vendor port, which shared one account model between its admin and storefront.
 * A customer's access is decided by owning the account, not by a grant — see
 * `DEC-ACCOUNT-SEPARATION`. Keeping an always-empty list would invite somebody to start gating
 * on it and find it silently false.
 */
interface AccountStateModel {
	user: IAccountUser | null;
}

export const AccountStore = signalStore(
	{ providedIn: 'root' },
	withState<AccountStateModel>({ user: null }),
	withMethods((store, accountService = inject(AccountService), addresses = inject(AccountAddressService)) => ({
		/**
		 * Loads the signed-in customer, and SURVIVES a failure.
		 *
		 * The `catchError` is load-bearing rather than defensive. This read used to be a static
		 * fixture that could not fail; it is now `/auth/storefront/me`, which answers 401 for every
		 * anonymous visitor. Without it the error escapes the `rxMethod` stream — which on the
		 * server means an unhandled rejection that takes the whole SSR render down, so a logged-out
		 * visitor gets no page at all rather than the public one.
		 *
		 * `EMPTY` leaves `user` as it was: null for a visitor who was never signed in, and the last
		 * known value if a refresh momentarily fails. Clearing on any error would sign people out of
		 * the UI over one flaky request.
		 */
		loadUser: rxMethod<void>(
			pipe(
				switchMap(() =>
					accountService.GetUserDetails().pipe(
						tap((result) => patchState(store, { user: result })),
						catchError(() => EMPTY),
					),
				),
			),
		),
		clear(): void {
			patchState(store, { user: null });
		},
		/**
		 * Address writes, against the customer's OWN routes.
		 *
		 * Each answers the whole updated customer and the store adopts it wholesale, so the list
		 * on screen is the server's and never a local guess about what the write did.
		 *
		 * These were empty function bodies until now — "Add", "Edit" and "Remove" submitted and
		 * silently did nothing, which the static fixture hid because the rows were not real
		 * either.
		 */
		async createAddress(address: Omit<ICustomerAddress, 'id'>): Promise<boolean> {
			return this.write(addresses.create(address));
		},
		async updateAddress(addressId: string, address: Partial<Omit<ICustomerAddress, 'id'>>): Promise<boolean> {
			return this.write(addresses.update(addressId, address));
		},
		async deleteAddress(addressId: string): Promise<boolean> {
			return this.write(addresses.remove(addressId));
		},
		/** Shared tail: adopt the server's customer, or report the failure to the caller. */
		async write(request: Observable<IAccountUser>): Promise<boolean> {
			try {
				patchState(store, { user: await firstValueFrom(request) });
				return true;
			} catch {
				// The HTTP interceptor already raises the toast; the caller only needs to know
				// whether to close its dialog.
				return false;
			}
		},
		/** Display name only; the API refuses anything else on this route, deliberately. */
		async updateProfile(displayName: string): Promise<boolean> {
			return this.write(addresses.updateProfile(displayName));
		},
	})),
);
