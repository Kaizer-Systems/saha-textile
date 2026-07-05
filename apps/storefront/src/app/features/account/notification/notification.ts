import { AsyncPipe, DatePipe, isPlatformBrowser } from '@angular/common';
import { Component, inject, PLATFORM_ID } from '@angular/core';

import { TranslateModule } from '@ngx-translate/core';
import { Store } from '@ngxs/store';
import { Observable } from 'rxjs';

import { MarkAsReadNotificationAction } from '@data-access/actions/notification.action';
import { NoData } from '@shared/ui/no-data/no-data';
import { INotification } from '@data-access/interfaces/notification.interface';
import { NotificationState } from '@data-access/states/notification.state';

@Component({
  selector: 'app-notification',
  templateUrl: './notification.html',
  styleUrls: ['./notification.scss'],
  imports: [NoData, AsyncPipe, DatePipe, TranslateModule],
})
export class Notification {
  private store = inject(Store);
  private platformId = inject(PLATFORM_ID);

  notification$: Observable<INotification[]> = inject(Store).select(
    NotificationState.notification,
  ) as Observable<INotification[]>;

  ngOnDestroy() {
    if (isPlatformBrowser(this.platformId)) {
      this.store.dispatch(new MarkAsReadNotificationAction());
    }
  }
}
