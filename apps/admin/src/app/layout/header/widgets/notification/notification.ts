import { SlicePipe } from '@angular/common';
import { Component, computed, inject } from '@angular/core';
import { RouterModule } from '@angular/router';

import { TranslocoModule } from '@jsverse/transloco';

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

	private readonly notificationsQuery = injectNotificationsQuery();
	readonly notifications = computed(() => this.notificationsQuery.data()?.data ?? []);
	readonly unreadNotificationCount = computed(() => this.notifications().filter((item) => !item.read_at).length);

	public active: boolean = false;

	clickHeaderOnMobile() {
		this.active = !this.active;
	}
}
