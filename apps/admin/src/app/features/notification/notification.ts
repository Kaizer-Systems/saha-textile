import { DatePipe } from '@angular/common';
import { Component, computed } from '@angular/core';

import { injectNotificationsQuery } from '@data-access/queries/notification.queries';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';

@Component({
  selector: 'app-notification',
  templateUrl: './notification.html',
  styleUrls: ['./notification.scss'],
  imports: [PageWrapper, DatePipe],
})
export class Notification {
  private readonly notificationsQuery = injectNotificationsQuery();
  readonly notifications = computed(() => this.notificationsQuery.data()?.data ?? []);
}
