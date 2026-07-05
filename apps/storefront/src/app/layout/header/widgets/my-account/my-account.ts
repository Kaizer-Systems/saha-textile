import { AsyncPipe } from '@angular/common';
import { Component, inject, input, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';

import { TranslateModule } from '@ngx-translate/core';
import { Store } from '@ngxs/store';
import { Observable } from 'rxjs';

import { LogoutAction } from '@data-access/actions/auth.action';
import { IAccountUser } from '@data-access/interfaces/account.interface';
import { AccountState } from '@data-access/states/account.state';
import { AuthState } from '@data-access/states/auth.state';
import { ConfirmationModal } from '@shared/ui/modal/confirmation-modal/confirmation-modal';

@Component({
  selector: 'app-my-account',
  templateUrl: './my-account.html',
  styleUrls: ['./my-account.scss'],
  imports: [RouterLink, ConfirmationModal, AsyncPipe, TranslateModule],
})
export class MyAccount {
  private store = inject(Store);

  readonly style = input<string>('basic');

  isAuthenticated$: Observable<Boolean> = inject(Store).select(AuthState.isAuthenticated);
  user$: Observable<IAccountUser> = inject(Store).select(
    AccountState.user,
  ) as Observable<IAccountUser>;

  readonly ConfirmationModal = viewChild<ConfirmationModal>('confirmationModal');

  logout() {
    this.store.dispatch(new LogoutAction());
  }
}
