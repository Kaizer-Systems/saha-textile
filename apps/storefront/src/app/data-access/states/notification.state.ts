import { Injectable, inject } from '@angular/core';

import { Action, Selector, State, StateContext } from '@ngxs/store';
import { tap } from 'rxjs';

import {
  GetNotificationAction,
  MarkAsReadNotificationAction,
  DeleteNotificationAction,
} from '@data-access/actions/notification.action';
import { INotification } from '@data-access/interfaces/notification.interface';
import { NotificationService } from '../services/notification.service';

export class NotificationStateModel {
  notification = {
    data: [] as INotification[],
    total: 0,
  };
}

@State<NotificationStateModel>({
  name: 'notification',
  defaults: {
    notification: {
      data: [],
      total: 0,
    },
  },
})
@Injectable()
export class NotificationState {
  private notificationService = inject(NotificationService);

  @Selector()
  static notification(state: NotificationStateModel) {
    return state.notification.data;
  }

  @Action(GetNotificationAction)
  getNotification(ctx: StateContext<NotificationStateModel>, action: GetNotificationAction) {
    return this.notificationService.getNotifications(action?.payload).pipe(
      tap({
        next: result => {
          ctx.patchState({
            notification: {
              data: result.data,
              total: result?.total ? result?.total : result.data ? result.data.length : 0,
            },
          });
        },
        error: err => {
          throw new Error(err?.error?.message);
        },
      }),
    );
  }

  @Action(MarkAsReadNotificationAction)
  markAsRead(_ctx: StateContext<NotificationStateModel>) {
    // Notification Mark As Read Logic Here
  }

  @Action(DeleteNotificationAction)
  delete(_ctx: StateContext<NotificationStateModel>, { id: _id }: DeleteNotificationAction) {
    // Delete Notification Logic Here
  }
}
