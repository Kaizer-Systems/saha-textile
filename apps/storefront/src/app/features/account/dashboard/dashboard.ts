import { AsyncPipe } from '@angular/common';
import { Component, inject, viewChild } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';

import { TranslocoModule } from '@jsverse/transloco';
import { Observable } from 'rxjs';

import { AccountStore } from '@core/state/account.store';
import { IUser, IUserAddress } from '@data-access/interfaces/user.interface';
import { CurrencySymbolPipe } from '@shared/pipes/currency-symbol.pipe';
import { TitleCasePipe } from '@shared/pipes/title-case.pipe';
import { EditProfileModal } from '@shared/ui/modal/edit-profile-modal/edit-profile-modal';

@Component({
	selector: 'app-dashboard',
	templateUrl: './dashboard.html',
	styleUrls: ['./dashboard.scss'],
	providers: [CurrencySymbolPipe],
	imports: [EditProfileModal, RouterLink, AsyncPipe, TitleCasePipe, CurrencySymbolPipe, TranslocoModule],
})
export class Dashboard {
	private accountStore = inject(AccountStore);
	user$: Observable<IUser> = toObservable(this.accountStore.user) as unknown as Observable<IUser>;

	readonly ProfileModal = viewChild<EditProfileModal>('profileModal');

	public address: IUserAddress | null;

	constructor() {
		this.user$.subscribe((user) => {
			if (user) {
				this.address = user?.address?.length ? user?.address?.[0] : null;
			}
		});
	}
}
