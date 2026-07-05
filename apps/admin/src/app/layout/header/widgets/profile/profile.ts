import { AsyncPipe } from '@angular/common';
import { Component, inject, viewChild } from '@angular/core';
import { RouterModule } from '@angular/router';

import { toObservable } from '@angular/core/rxjs-interop';
import { TranslateModule } from '@ngx-translate/core';
import { Observable } from 'rxjs';

import { AccountStore } from '@core/state/account.store';
import { AuthStore } from '@core/state/auth.store';
import { IAccountUser } from '@data-access/interfaces/account.interface';
import { ConfirmationModal } from '@shared/ui/modal/confirmation-modal/confirmation-modal';

@Component({
	selector: 'app-profile',
	templateUrl: './profile.html',
	styleUrls: ['./profile.scss'],
	imports: [RouterModule, ConfirmationModal, TranslateModule, AsyncPipe],
})
export class Profile {
	private accountStore = inject(AccountStore);
	private authStore = inject(AuthStore);

	user$: Observable<IAccountUser | null> = toObservable(this.accountStore.user);

	readonly ConfirmationModal = viewChild<ConfirmationModal>('confirmationModal');

	public active: boolean = false;

	clickHeaderOnMobile() {
		this.active = !this.active;
	}

	logout() {
		this.authStore.logout();
	}
}
