import { inject } from '@angular/core';

import { injectQuery } from '@tanstack/angular-query-experimental';
import { lastValueFrom } from 'rxjs';

import { AdminCommunicationsGateway } from '@core/admin-communications/admin-communications.gateway';

export const COMMUNICATIONS_QUERY_KEY = ['admin-communications'] as const;

export function injectCommunicationSettingsQuery() {
	const gateway = inject(AdminCommunicationsGateway);
	return injectQuery(() => ({
		queryKey: COMMUNICATIONS_QUERY_KEY,
		queryFn: () => lastValueFrom(gateway.settings()),
	}));
}
