import { Component, computed } from '@angular/core';
import { RouterLink } from '@angular/router';

import { injectCategoriesQuery } from '@data-access/queries/category.queries';

/** The shop's top categories. They come from the catalogue, so a new one appears here by itself. */
@Component({
	selector: 'app-footer-categories',
	templateUrl: './categories.html',
	styleUrls: ['./categories.scss'],
	imports: [RouterLink],
})
export class FooterCategories {
	private readonly categoriesQuery = injectCategoriesQuery();

	readonly categories = computed(() => (this.categoriesQuery.data()?.data ?? []).filter((row) => !row.parent_id));
}
