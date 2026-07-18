import { inject } from '@angular/core';

import { injectQuery } from '@tanstack/angular-query-experimental';
import { firstValueFrom } from 'rxjs';

import { Params } from '@data-access/interfaces/core.interface';
import { CategoryService } from '@data-access/services/category.service';

/**
 * TanStack Query for categories (replaces NGXS CategoryState + GetCategoriesAction,
 * which the Layout used to prefetch). Reference data — cache indefinitely. All
 * consumers use { status: 1 } so they share one cache entry.
 */
export function injectCategoriesQuery(params: () => Params) {
	const categoryService = inject(CategoryService);
	return injectQuery(() => ({
		queryKey: ['categories', params()],
		queryFn: () => firstValueFrom(categoryService.getCategories(params())),
		staleTime: Infinity,
	}));
}
