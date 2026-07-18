import { AsyncPipe } from '@angular/common';
import { Component, inject, viewChild } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';

import { TranslocoModule } from '@jsverse/transloco';
import { Observable } from 'rxjs';

import { AccountStore } from '@core/state/account.store';
import { IAccountUser } from '@data-access/interfaces/account.interface';
import { IUserAddress } from '@data-access/interfaces/user.interface';
import { TitleCasePipe } from '@shared/pipes/title-case.pipe';
import { Button } from '@shared/ui/button/button';
import { AddressModal } from '@shared/ui/modal/address-modal/address-modal';
import { DeleteModal } from '@shared/ui/modal/delete-modal/delete-modal';
import { NoData } from '@shared/ui/no-data/no-data';

@Component({
	selector: 'app-adresses',
	templateUrl: './adresses.html',
	styleUrls: ['./adresses.scss'],
	imports: [Button, NoData, AddressModal, DeleteModal, AsyncPipe, TitleCasePipe, TranslocoModule],
})
export class Adresses {
	private accountStore = inject(AccountStore);

	user$: Observable<IAccountUser> = toObservable(this.accountStore.user) as Observable<IAccountUser>;

	readonly AddressModal = viewChild<AddressModal>('addressModal');
	readonly DeleteModal = viewChild<DeleteModal>('deleteModal');

	delete(action: string, data: IUserAddress) {
		if (action == 'delete') this.accountStore.deleteAddress(data.id);
	}
}
