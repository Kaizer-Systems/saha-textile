import { inject } from '@angular/core';

import { injectQuery } from '@tanstack/angular-query-experimental';
import { lastValueFrom } from 'rxjs';

import { PageBuilderGateway } from '@core/page-builder/page-builder.gateway';

/** The bell's Page Builder lines (SG-12, SG-18): reviews asked and the nightly check; refreshed every 5 minutes. */
export function injectPageBuilderAlertsQuery(enabled: () => boolean = () => true) {
	const gateway = inject(PageBuilderGateway);
	return injectQuery(() => ({
		queryKey: ['page-builder', 'alerts'] as const,
		queryFn: () => lastValueFrom(gateway.alerts()),
		staleTime: 300_000,
		enabled: enabled(),
	}));
}
