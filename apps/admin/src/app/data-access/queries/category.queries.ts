import { inject } from '@angular/core';
import { injectQuery } from '@tanstack/angular-query-experimental';
import { firstValueFrom } from 'rxjs';

import { Params } from '@data-access/interfaces/core.interface';
import { CategoryService } from '@data-access/services/category.service';

export function injectCategoriesQuery(params: () => Params) {
	const categoryService = inject(CategoryService);
	return injectQuery(() => ({
		queryKey: ['categories', params()],
		queryFn: () => firstValueFrom(categoryService.getCategories(params())),
	}));
}
