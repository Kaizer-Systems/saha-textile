import { isPlatformBrowser } from '@angular/common';
import { Component, PLATFORM_ID, computed, inject, input, output } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';

import { TranslocoModule } from '@jsverse/transloco';
import { CarouselModule, OwlOptions } from 'ngx-owl-carousel-o';
import { Observable } from 'rxjs';

import { ICategory, ICategoryModel } from '@data-access/interfaces/category.interface';
import { injectCategoriesQuery } from '@data-access/queries/category.queries';

import { Button } from '../button/button';

@Component({
	selector: 'app-categories',
	templateUrl: './categories.html',
	styleUrls: ['./categories.scss'],
	imports: [Button, CarouselModule, ReactiveFormsModule, TranslocoModule],
})
export class Categories {
	private route = inject(ActivatedRoute);
	private router = inject(Router);

	private readonly categoriesQuery = injectCategoriesQuery(() => ({ status: 1 }));
	category$: Observable<ICategoryModel> = toObservable(
		computed(() => this.categoriesQuery.data() ?? { data: [], total: 0 }),
	);

	readonly categoryIds = input<number[]>([]);
	readonly style = input<string>('vertical');
	// TODO: Skipped for migration because:
	//  This input is used in a control flow expression (e.g. `@if` or `*ngIf`)
	//  and migrating would break narrowing currently.
	readonly title = input<string>();
	// TODO: Skipped for migration because:
	//  This input is used in a control flow expression (e.g. `@if` or `*ngIf`)
	//  and migrating would break narrowing currently.
	readonly image = input<string>();
	readonly theme = input<string>();
	readonly sliderOption = input<OwlOptions>();
	readonly selectedCategoryId = input<number>();
	readonly bgImage = input<string>();

	readonly selectedCategory = output<number>();

	public categories: ICategory[];
	public selectedCategorySlug: string[] = [];
	public isBrowser: boolean;

	constructor() {
		const platformID = inject(PLATFORM_ID);

		this.isBrowser = isPlatformBrowser(platformID);
		this.category$.subscribe(
			(res) => (this.categories = res?.data?.filter((category) => category.type == 'product')),
		);
		this.route.queryParams.subscribe((params) => {
			this.selectedCategorySlug = params['category'] ? params['category'].split(',') : [];
		});
	}

	ngOnChanges() {
		const categoryIds = this.categoryIds();
		if (categoryIds && categoryIds.length) {
			this.category$.subscribe(
				(res) => (this.categories = res.data.filter((category) => this.categoryIds()?.includes(category.id))),
			);
		}
	}

	selectCategory(id: number) {
		this.selectedCategory.emit(id);
	}

	redirectToCollection(slug: string) {
		let index = this.selectedCategorySlug.indexOf(slug);
		if (index === -1) this.selectedCategorySlug.push(slug);
		else this.selectedCategorySlug.splice(index, 1);

		void this.router.navigate(['/collections'], {
			relativeTo: this.route,
			queryParams: {
				category: this.selectedCategorySlug.length ? this.selectedCategorySlug.join(',') : null,
			},
			queryParamsHandling: 'merge', // preserve the existing query params in the route
			skipLocationChange: false, // do trigger navigation
		});
	}
}
