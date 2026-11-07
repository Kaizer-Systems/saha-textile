import { inject } from '@angular/core';

import { injectQuery } from '@tanstack/angular-query-experimental';
import { firstValueFrom } from 'rxjs';

import { MediaGateway } from '@core/media/media.gateway';
import { Params } from '@data-access/interfaces/core.interface';

/** The media library, from the API (owner log § Media), in the grid's existing shape. */
export function injectAttachmentsQuery(params: () => Params) {
	const gateway = inject(MediaGateway);
	return injectQuery(() => ({
		queryKey: ['attachments', params()],
		queryFn: () =>
			firstValueFrom(
				gateway.library({
					search: (params()['search'] as string) || undefined,
					page: Number(params()['page'] ?? 1),
					pageSize: Number(params()['paginate'] ?? 48),
				}),
			),
	}));
}
