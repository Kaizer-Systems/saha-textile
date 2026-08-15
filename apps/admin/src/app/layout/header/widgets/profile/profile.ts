import { Component, computed, inject, viewChild } from '@angular/core';
import { RouterModule } from '@angular/router';

import { TranslocoModule } from '@jsverse/transloco';

import { AuthStore } from '@core/state/auth.store';
import { ConfirmationModal } from '@shared/ui/modal/confirmation-modal/confirmation-modal';

@Component({
	selector: 'app-profile',
	templateUrl: './profile.html',
	styleUrls: ['./profile.scss'],
	imports: [RouterModule, ConfirmationModal, TranslocoModule],
})
export class Profile {
	private authStore = inject(AuthStore);

	readonly displayName = computed(() => {
		const user = this.authStore.user();
		return user?.username || user?.email || '';
	});

	readonly displayInitial = computed(() => this.displayName().charAt(0).toUpperCase());

	readonly roleLabel = computed(() => this.authStore.user()?.role ?? '');

	readonly ConfirmationModal = viewChild<ConfirmationModal>('confirmationModal');

	public active: boolean = false;

	clickHeaderOnMobile() {
		this.active = !this.active;
	}

	logout() {
		void this.authStore.logout();
	}
}
