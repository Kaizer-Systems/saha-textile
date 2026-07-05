import { inject } from '@angular/core';
import { injectQuery } from '@tanstack/angular-query-experimental';
import { firstValueFrom } from 'rxjs';

import { Params } from '@data-access/interfaces/core.interface';
import { TagService } from '@data-access/services/tag.service';

/**
 * Server-state (TanStack Query) for tags — the pattern for our server-data:
 * a query factory in `data-access/queries/<feature>.queries.ts` that wraps the
 * existing `data-access/services/` HTTP client. Components call it as a field
 * initializer (injection context) and read `.data()` / `.isLoading()` signals.
 * Reactive `params`/`id` accessors make the query auto-refetch on change.
 */
export function injectTagsQuery(params: () => Params) {
	const tagService = inject(TagService);
	return injectQuery(() => ({
		queryKey: ['tags', params()],
		queryFn: () => firstValueFrom(tagService.getTags(params())),
	}));
}

/** Single tag by id (mock has no detail endpoint — find within the list). */
export function injectTagQuery(id: () => number | undefined) {
	const tagService = inject(TagService);
	return injectQuery(() => ({
		queryKey: ['tag', id()],
		enabled: id() != null,
		queryFn: async () => {
			const res = await firstValueFrom(tagService.getTags());
			return res.data.find((tag) => tag.id == id()) ?? null;
		},
	}));
}
