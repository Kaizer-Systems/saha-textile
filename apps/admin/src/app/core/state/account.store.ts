import { inject } from '@angular/core';

import { patchState, signalStore, withMethods, withState } from '@ngrx/signals';
import { Observable, tap } from 'rxjs';

import { IAccountUser } from '@data-access/interfaces/account.interface';
import { IPermission } from '@data-access/interfaces/role.interface';
import { AccountService } from '@data-access/services/account.service';

interface AccountStateModel {
	user: IAccountUser | null;
	permissions: IPermission[];
	roleName: string | null;
}

const initialState: AccountStateModel = {
	user: null,
	permissions: [],
	roleName: null,
};

export const AccountStore = signalStore(
	{ providedIn: 'root' },
	withState(initialState),
	withMethods((store, accountService = inject(AccountService)) => ({
		loadUserDetails(): Observable<IAccountUser> {
			return accountService.getUserDetails().pipe(
				tap((result) => {
					if (result) {
						patchState(store, {
							user: result,
							permissions: result.permission,
							roleName: result.role ? result.role.name : '',
						});
					}
				}),
			);
		},
		clear() {
			patchState(store, { user: null, permissions: [], roleName: null });
		},
	})),
);
