import { SlicePipe } from '@angular/common';
import { Component, computed, inject } from '@angular/core';
import { RouterModule } from '@angular/router';

import { TranslocoModule } from '@jsverse/transloco';
import { languageName } from '@saha-textile/core-domain/languages';

import { AuthStore } from '@core/state/auth.store';
import { injectLanguageRemindersQuery } from '@data-access/queries/admin-languages.queries';
import { injectNotificationsQuery } from '@data-access/queries/notification.queries';
import { NavService } from '@data-access/services/nav.service';
import { SummaryPipe } from '@shared/pipes/summary.pipe';

@Component({
	selector: 'app-notification',
	templateUrl: './notification.html',
	styleUrls: ['./notification.scss'],
	imports: [RouterModule, SlicePipe, TranslocoModule, SummaryPipe],
})
export class Notification {
	navServices = inject(NavService);

	private readonly authStore = inject(AuthStore);
	private readonly notificationsQuery = injectNotificationsQuery();
	readonly notifications = computed(() => this.notificationsQuery.data()?.data ?? []);
	/**
	 * Deleted languages whose text is still stored, 30 days on and every 30 days after (Settings ›
	 * Languages). Asked only of people who manage languages; each opens the erase popup.
	 */
	private readonly remindersQuery = injectLanguageRemindersQuery(() =>
		this.authStore.permissions().includes('language.manage'),
	);
	readonly languageReminders = computed(() => this.remindersQuery.data()?.reminders ?? []);
	readonly unreadNotificationCount = computed(
		() => this.languageReminders().length + this.notifications().filter((item) => !item.read_at).length,
	);

	languageName(code: string): string {
		return languageName(code);
	}

	public active: boolean = false;

	clickHeaderOnMobile() {
		this.active = !this.active;
	}
}
