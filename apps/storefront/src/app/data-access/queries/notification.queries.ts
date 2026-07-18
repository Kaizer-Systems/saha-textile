import { inject } from '@angular/core';

import { injectQuery } from '@tanstack/angular-query-experimental';
import { firstValueFrom } from 'rxjs';

import { Params } from '@data-access/interfaces/core.interface';
import { INotification, INotificationModel } from '@data-access/interfaces/notification.interface';
import { NotificationService } from '@data-access/services/notification.service';

/**
 * Notification list (replaces NGXS NotificationState + GetNotificationAction).
 * It was only ever a server read — MarkAsRead/Delete were no-op stubs — so it
 * moves to TanStack Query rather than a SignalStore. Selects the data array.
 */
export function injectNotificationsQuery(params: () => Params | undefined = () => undefined) {
	const notificationService = inject(NotificationService);
	return injectQuery(() => ({
		queryKey: ['notifications', params()],
		queryFn: () => firstValueFrom(notificationService.getNotifications(params())),
		select: (res: INotificationModel): INotification[] => res.data,
		staleTime: Infinity,
	}));
}
