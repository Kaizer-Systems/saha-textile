import { inject } from '@angular/core';

import { injectQuery } from '@tanstack/angular-query-experimental';
import { lastValueFrom } from 'rxjs';

import { AdminNotificationsGateway } from '@core/admin-notifications/admin-notifications.gateway';

export function injectNotificationProviderQuery() {
	const gateway = inject(AdminNotificationsGateway);
	return injectQuery(() => ({
		queryKey: ['admin-notifications', 'provider'],
		queryFn: () => lastValueFrom(gateway.providerStatus()),
	}));
}

export function injectNotificationChannelsQuery() {
	const gateway = inject(AdminNotificationsGateway);
	return injectQuery(() => ({
		queryKey: ['admin-notifications', 'channels'],
		queryFn: () => lastValueFrom(gateway.listChannels()),
	}));
}

export function injectNotificationTemplatesQuery() {
	const gateway = inject(AdminNotificationsGateway);
	return injectQuery(() => ({
		queryKey: ['admin-notifications', 'templates'],
		queryFn: () => lastValueFrom(gateway.listTemplates()),
	}));
}
