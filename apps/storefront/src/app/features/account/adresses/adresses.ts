import { AsyncPipe } from '@angular/common';
import { Component, inject, viewChild } from '@angular/core';

import { TranslateModule } from '@ngx-translate/core';
import { Store } from '@ngxs/store';
import { Observable } from 'rxjs';

import { DeleteAddressAction } from '@data-access/actions/account.action';
import { Button } from '@shared/ui/button/button';
import { AddressModal } from '@shared/ui/modal/address-modal/address-modal';
import { DeleteModal } from '@shared/ui/modal/delete-modal/delete-modal';
import { NoData } from '@shared/ui/no-data/no-data';
import { IAccountUser } from '@data-access/interfaces/account.interface';
import { IUserAddress } from '@data-access/interfaces/user.interface';
import { TitleCasePipe } from '@shared/pipes/title-case.pipe';
import { AccountState } from '@data-access/states/account.state';

@Component({
  selector: 'app-adresses',
  templateUrl: './adresses.html',
  styleUrls: ['./adresses.scss'],
  imports: [Button, NoData, AddressModal, DeleteModal, AsyncPipe, TitleCasePipe, TranslateModule],
})
export class Adresses {
  private store = inject(Store);

  user$: Observable<IAccountUser> = inject(Store).select(
    AccountState.user,
  ) as Observable<IAccountUser>;

  readonly AddressModal = viewChild<AddressModal>('addressModal');
  readonly DeleteModal = viewChild<DeleteModal>('deleteModal');

  delete(action: string, data: IUserAddress) {
    if (action == 'delete') this.store.dispatch(new DeleteAddressAction(data.id));
  }
}
