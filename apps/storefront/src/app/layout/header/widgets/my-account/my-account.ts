import { AsyncPipe } from '@angular/common';
import { Component, inject, input, viewChild } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';

import { TranslateModule } from '@ngx-translate/core';
import { Observable } from 'rxjs';

import { IAccountUser } from '@data-access/interfaces/account.interface';
import { AccountStore } from '@core/state/account.store';
import { AuthStore } from '@core/state/auth.store';
import { ConfirmationModal } from '@shared/ui/modal/confirmation-modal/confirmation-modal';

@Component({
  selector: 'app-my-account',
  templateUrl: './my-account.html',
  styleUrls: ['./my-account.scss'],
  imports: [RouterLink, ConfirmationModal, AsyncPipe, TranslateModule],
})
export class MyAccount {
  private authStore = inject(AuthStore);
  private accountStore = inject(AccountStore);

  readonly style = input<string>('basic');

  isAuthenticated$: Observable<boolean> = toObservable(this.authStore.isAuthenticated);
  user$: Observable<IAccountUser> = toObservable(this.accountStore.user) as Observable<IAccountUser>;

  readonly ConfirmationModal = viewChild<ConfirmationModal>('confirmationModal');

  logout() {
    this.authStore.logout();
  }
}
