import { AsyncPipe } from '@angular/common';
import { Component, inject, viewChild } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';

import { TranslateModule } from '@ngx-translate/core';
import { Observable } from 'rxjs';

import { ChangePasswordModal } from '@shared/ui/modal/change-password-modal/change-password-modal';
import { EditProfileModal } from '@shared/ui/modal/edit-profile-modal/edit-profile-modal';
import { IUser, IUserAddress } from '@data-access/interfaces/user.interface';
import { CurrencySymbolPipe } from '@shared/pipes/currency-symbol.pipe';
import { TitleCasePipe } from '@shared/pipes/title-case.pipe';
import { AccountStore } from '@core/state/account.store';

@Component({
  selector: 'app-dashboard',
  templateUrl: './dashboard.html',
  styleUrls: ['./dashboard.scss'],
  providers: [CurrencySymbolPipe],
  imports: [
    EditProfileModal,
    ChangePasswordModal,
    AsyncPipe,
    TitleCasePipe,
    CurrencySymbolPipe,
    TranslateModule,
  ],
})
export class Dashboard {
  private accountStore = inject(AccountStore);
  user$: Observable<IUser> = toObservable(this.accountStore.user) as unknown as Observable<IUser>;

  readonly ProfileModal = viewChild<EditProfileModal>('profileModal');
  readonly PasswordModal = viewChild<ChangePasswordModal>('passwordModal');

  public address: IUserAddress | null;

  constructor() {
    this.user$.subscribe(user => {
      if (user) {
        this.address = user?.address?.length ? user?.address?.[0] : null;
      }
    });
  }
}
