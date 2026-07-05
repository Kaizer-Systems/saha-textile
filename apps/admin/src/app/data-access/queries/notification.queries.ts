import { inject } from '@angular/core';
import { injectQuery } from '@tanstack/angular-query-experimental';
import { firstValueFrom } from 'rxjs';

import { Params } from '@data-access/interfaces/core.interface';
import { NotificationService } from '@data-access/services/notification.service';

export function injectNotificationsQuery(params: () => Params = () => ({})) {
	const notificationService = inject(NotificationService);
	return injectQuery(() => ({
		queryKey: ['notifications', params()],
		queryFn: () => firstValueFrom(notificationService.getNotifications(params())),
	}));
}
