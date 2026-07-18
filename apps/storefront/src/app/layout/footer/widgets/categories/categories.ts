import { Component, computed, input, SimpleChanges } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';

import { Observable } from 'rxjs';

import { ICategory, ICategoryModel } from '@data-access/interfaces/category.interface';
import { ISiteConfig } from '@data-access/interfaces/site-config.interface';
import { injectCategoriesQuery } from '@data-access/queries/category.queries';

@Component({
	selector: 'app-footer-categories',
	templateUrl: './categories.html',
	styleUrls: ['./categories.scss'],
	imports: [RouterLink],
})
export class FooterCategories {
	readonly data = input<ISiteConfig | null>();

	private readonly categoriesQuery = injectCategoriesQuery(() => ({ status: 1 }));
	category$: Observable<ICategoryModel> = toObservable(
		computed(() => this.categoriesQuery.data() ?? { data: [], total: 0 }),
	);

	public categories: ICategory[];

	ngOnChanges(changes: SimpleChanges) {
		const ids = changes['data']?.currentValue?.footer?.footer_categories;
		if (Array.isArray(ids)) {
			this.category$.subscribe((categories) => {
				if (Array.isArray(categories.data)) {
					this.categories = categories.data.filter((category) => ids?.includes(category.id));
				}
			});
		}
	}
}
