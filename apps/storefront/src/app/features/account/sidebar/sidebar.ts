import { AsyncPipe } from '@angular/common';
import { Component, computed, inject, viewChild, output, input } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { RouterLinkActive, RouterLink } from '@angular/router';

import { TranslocoModule } from '@jsverse/transloco';
import { Observable } from 'rxjs';

import { AccountStore } from '@core/state/account.store';
import { AuthStore } from '@core/state/auth.store';
import { INotification } from '@data-access/interfaces/notification.interface';
import { IUser } from '@data-access/interfaces/user.interface';
import { injectNotificationsQuery } from '@data-access/queries/notification.queries';
import { TitleCasePipe } from '@shared/pipes/title-case.pipe';
import { Button } from '@shared/ui/button/button';
import { ConfirmationModal } from '@shared/ui/modal/confirmation-modal/confirmation-modal';

@Component({
	selector: 'app-sidebar',
	templateUrl: './sidebar.html',
	styleUrls: ['./sidebar.scss'],
	imports: [Button, RouterLinkActive, RouterLink, ConfirmationModal, AsyncPipe, TitleCasePipe, TranslocoModule],
})
export class Sidebar {
	private authStore = inject(AuthStore);
	private accountStore = inject(AccountStore);

	readonly show = input<boolean>();
	readonly menu = output<boolean>();

	private readonly notificationsQuery = injectNotificationsQuery();
	notification$: Observable<INotification[]> = toObservable(computed(() => this.notificationsQuery.data() ?? []));
	user$: Observable<IUser> = toObservable(this.accountStore.user) as unknown as Observable<IUser>;

	readonly ConfirmationModal = viewChild<ConfirmationModal>('confirmationModal');

	public unreadNotificationCount: number;

	constructor() {
		this.notification$.subscribe((notification) => {
			this.unreadNotificationCount = notification?.filter((item) => !item.read_at).length;
		});
	}

	logout() {
		// `logout()` is now async — it revokes the session server-side before clearing
		// local state. It never rejects (the store swallows transport failures and clears
		// regardless), so there is nothing for this click handler to await or handle.
		void this.authStore.logout();
	}

	openMenu(value: boolean) {
		this.menu.emit(value);
	}
}
