import { AsyncPipe } from '@angular/common';
import { Component, inject, viewChild } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { RouterModule } from '@angular/router';

import { TranslocoModule } from '@jsverse/transloco';
import { Observable } from 'rxjs';

import { AccountStore } from '@core/state/account.store';
import { AuthStore } from '@core/state/auth.store';
import { IAccountUser } from '@data-access/interfaces/account.interface';
import { ConfirmationModal } from '@shared/ui/modal/confirmation-modal/confirmation-modal';

@Component({
	selector: 'app-profile',
	templateUrl: './profile.html',
	styleUrls: ['./profile.scss'],
	imports: [RouterModule, ConfirmationModal, TranslocoModule, AsyncPipe],
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
		// `logout()` is now async — it revokes the session server-side before clearing
		// local state. It never rejects (the store swallows transport failures and clears
		// regardless), so there is nothing for this click handler to await or handle.
		void this.authStore.logout();
	}
}
