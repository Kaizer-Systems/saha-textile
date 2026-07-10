import { AsyncPipe, DatePipe } from '@angular/common';
import { Component, computed } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';

import { TranslateModule } from '@ngx-translate/core';
import { Observable } from 'rxjs';

import { injectNotificationsQuery } from '@data-access/queries/notification.queries';
import { NoData } from '@shared/ui/no-data/no-data';
import { INotification } from '@data-access/interfaces/notification.interface';

@Component({
  selector: 'app-notification',
  templateUrl: './notification.html',
  styleUrls: ['./notification.scss'],
  imports: [NoData, AsyncPipe, DatePipe, TranslateModule],
})
export class Notification {
  // Mark-as-read on destroy was a no-op stub with no backend, so it's dropped.
  private readonly notificationsQuery = injectNotificationsQuery();
  notification$: Observable<INotification[]> = toObservable(
    computed(() => this.notificationsQuery.data() ?? []),
  );
}
