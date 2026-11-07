import { inject } from '@angular/core';

import { injectQuery } from '@tanstack/angular-query-experimental';
import { firstValueFrom } from 'rxjs';

import { ACTIVE_LOCALE } from '@core/i18n/active-locale';
import { Params } from '@data-access/interfaces/core.interface';
import { CategoryService } from '@data-access/services/category.service';

/** The shop's categories. The language is in the key, so a language change never reuses a name. */
export function injectCategoriesQuery() {
	const categoryService = inject(CategoryService);
	const locale = inject(ACTIVE_LOCALE);
	return injectQuery(() => ({
		queryKey: ['categories', locale],
		queryFn: () => firstValueFrom(categoryService.getCategories()),
		staleTime: 5 * 60 * 1000,
	}));
}

export function injectBlogCategoriesQuery(params: () => Params) {
	const categoryService = inject(CategoryService);
	return injectQuery(() => ({
		queryKey: ['blog-categories', params()],
		queryFn: () => firstValueFrom(categoryService.getBlogCategories(params())),
		staleTime: Infinity,
	}));
}
