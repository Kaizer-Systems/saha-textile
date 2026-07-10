import { inject } from '@angular/core';

import { patchState, signalStore, withMethods, withState } from '@ngrx/signals';
import { rxMethod } from '@ngrx/signals/rxjs-interop';
import { pipe, switchMap, tap } from 'rxjs';

import { IAccountUser, IAccountUserUpdatePassword } from '@data-access/interfaces/account.interface';
import { IPermission } from '@data-access/interfaces/role.interface';
import { IUserAddress } from '@data-access/interfaces/user.interface';
import { AccountService } from '@data-access/services/account.service';

/**
 * User account/session (replaces NGXS AccountState + its actions). `user` is a
 * server read (loadUser); the profile/password/address mutations were no-op
 * stubs with no backend and stay as hook points for future API wiring.
 */
type AccountStateModel = {
  user: IAccountUser | null;
  permissions: IPermission[];
};

export const AccountStore = signalStore(
  { providedIn: 'root' },
  withState<AccountStateModel>({ user: null, permissions: [] }),
  withMethods((store, accountService = inject(AccountService)) => ({
    loadUser: rxMethod<void>(
      pipe(
        switchMap(() =>
          accountService
            .GetUserDetails()
            .pipe(
              tap(result => patchState(store, { user: result, permissions: result.permission })),
            ),
        ),
      ),
    ),
    clear(): void {
      patchState(store, { user: null, permissions: [] });
    },
    // No-op hook points (were empty NGXS reducers — backend wiring comes later).
    updateProfile(_payload: IAccountUser): void {},
    updatePassword(_payload: IAccountUserUpdatePassword): void {},
    createAddress(_payload: IUserAddress): void {},
    updateAddress(_payload: IUserAddress, _id: number): void {},
    deleteAddress(_id: number): void {},
  })),
);
