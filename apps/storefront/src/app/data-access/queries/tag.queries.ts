import { inject } from '@angular/core';

import { injectQuery } from '@tanstack/angular-query-experimental';
import { firstValueFrom } from 'rxjs';

import { Params } from '@data-access/interfaces/core.interface';
import { TagService } from '@data-access/services/tag.service';

/**
 * TanStack Query for tags (replaces NGXS TagState + GetTagsAction).
 * Effectively static reference data, so cache indefinitely (mirrors the old
 * "fetch once" behaviour).
 */
export function injectTagsQuery(params: () => Params) {
	const tagService = inject(TagService);
	return injectQuery(() => ({
		queryKey: ['tags', params()],
		queryFn: () => firstValueFrom(tagService.getTags(params())),
		staleTime: Infinity,
	}));
}
