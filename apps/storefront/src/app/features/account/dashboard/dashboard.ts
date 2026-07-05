import { AsyncPipe } from '@angular/common';
import { Component, inject, viewChild } from '@angular/core';

import { TranslateModule } from '@ngx-translate/core';
import { Store } from '@ngxs/store';
import { Observable } from 'rxjs';

import { ChangePasswordModal } from '@shared/ui/modal/change-password-modal/change-password-modal';
import { EditProfileModal } from '@shared/ui/modal/edit-profile-modal/edit-profile-modal';
import { IUser, IUserAddress } from '@data-access/interfaces/user.interface';
import { CurrencySymbolPipe } from '@shared/pipes/currency-symbol.pipe';
import { TitleCasePipe } from '@shared/pipes/title-case.pipe';
import { AccountState } from '@data-access/states/account.state';

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
  user$: Observable<IUser> = inject(Store).select(AccountState.user) as Observable<IUser>;

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
