import { Injectable, inject } from '@angular/core';

import { Action, Selector, State, StateContext } from '@ngxs/store';
import { tap } from 'rxjs';

import {
  AccountClearAction,
  CreateAddressAction,
  DeleteAddressAction,
  GetUserDetailsAction,
  UpdateAddressAction,
  UpdateUserPasswordAction,
  UpdateUserProfileAction,
} from '@data-access/actions/account.action';
import { IPermission } from '@data-access/interfaces/role.interface';
import { AccountService } from '../services/account.service';
import { IAccountUser, IAccountUserUpdatePassword } from '@data-access/interfaces/account.interface';

export class AccountStateModel {
  user: IAccountUser | null;
  permissions: IPermission[];
}

@State<AccountStateModel>({
  name: 'account',
  defaults: {
    user: null,
    permissions: [],
  },
})
@Injectable()
export class AccountState {
  private accountService = inject(AccountService);

  @Selector()
  static user(state: AccountStateModel) {
    return state.user;
  }

  @Selector()
  static permissions(state: AccountStateModel) {
    return state.permissions;
  }

  @Action(GetUserDetailsAction)
  GetUserDetails(ctx: StateContext<AccountStateModel>) {
    return this.accountService.GetUserDetails().pipe(
      tap({
        next: result => {
          ctx.patchState({
            user: result,
            permissions: result.permission,
          });
        },
        error: err => {
          throw new Error(err?.error?.message);
        },
      }),
    );
  }

  @Action(UpdateUserProfileAction)
  updateProfile(
    _ctx: StateContext<AccountStateModel>,
    { payload: _payload }: UpdateUserProfileAction,
  ) {
    // Update Profile Logic Here
  }

  @Action(UpdateUserPasswordAction)
  updatePassword(
    _ctx: StateContext<IAccountUserUpdatePassword>,
    { payload: _payload }: UpdateUserPasswordAction,
  ) {
    // Update Password Logic Here
  }

  @Action(CreateAddressAction)
  CreateAddress(_ctx: StateContext<AccountStateModel>, _action: CreateAddressAction) {
    // Create Address Logic Here
  }

  @Action(UpdateAddressAction)
  UpdateAddress(_ctx: StateContext<AccountStateModel>, _action: UpdateAddressAction) {
    // Update Address Logic Here
  }

  @Action(DeleteAddressAction)
  DeleteAddress(_ctx: StateContext<AccountStateModel>, _action: DeleteAddressAction) {
    // Delete Address Logic Here
  }

  @Action(AccountClearAction)
  AccountClear(ctx: StateContext<AccountStateModel>) {
    ctx.patchState({
      user: null,
      permissions: [],
    });
  }
}
