import { Component, computed, inject, input } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';

import { childCategories } from '@core/catalog/category-scope';
import { Params } from '@data-access/interfaces/core.interface';
import { injectCategoriesQuery } from '@data-access/queries/category.queries';

@Component({
	selector: 'app-collection-category-filter',
	templateUrl: './collection-category-filter.html',
	styleUrls: ['./collection-category-filter.scss'],
	imports: [],
})
export class CollectionCategoryFilter {
	private route = inject(ActivatedRoute);
	private router = inject(Router);

	private readonly categoriesQuery = injectCategoriesQuery();

	readonly filter = input<Params>();

	/** Only this page's children. A last-level category has nothing to narrow. */
	readonly categories = computed(() =>
		childCategories(this.categoriesQuery.data()?.data ?? [], this.filter()?.['path']),
	);
	public selectedCategories: string[] = [];

	ngOnChanges() {
		const filter = this.filter();
		this.selectedCategories = filter!['category'] ? filter!['category'].split(',') : [];
	}

	applyFilter(event: Event) {
		const index = this.selectedCategories.indexOf((<HTMLInputElement>event?.target)?.value); // checked and unchecked value

		if ((<HTMLInputElement>event?.target)?.checked)
			this.selectedCategories.push((<HTMLInputElement>event?.target)?.value); // push in array cheked value
		else this.selectedCategories.splice(index, 1); // removed in array unchecked value

		void this.router.navigate([], {
			relativeTo: this.route,
			queryParams: {
				category: this.selectedCategories.length ? this.selectedCategories.join(',') : null,
			},
			queryParamsHandling: 'merge', // preserve the existing query params in the route
			skipLocationChange: false, // do trigger navigation
		});
	}

	// check if the item are selected
	checked(item: string) {
		if (this.selectedCategories?.indexOf(item) != -1) {
			return true;
		}
		return false;
	}
}
