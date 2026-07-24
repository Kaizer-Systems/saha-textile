import { inject } from '@angular/core';

import { injectQuery } from '@tanstack/angular-query-experimental';
import { firstValueFrom } from 'rxjs';

import { Params } from '@data-access/interfaces/core.interface';
import { PageService } from '@data-access/services/page.service';

export function injectPagesQuery(params: () => Params) {
	const pageService = inject(PageService);
	return injectQuery(() => ({
		queryKey: ['pages', params()],
		queryFn: () => firstValueFrom(pageService.getPages(params())),
	}));
}
