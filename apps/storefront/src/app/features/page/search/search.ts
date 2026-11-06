import { isPlatformBrowser } from '@angular/common';
import { Component, PLATFORM_ID, computed, inject, signal } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';

import { TranslocoModule } from '@jsverse/transloco';
import { EMPTY, catchError, debounceTime, distinctUntilChanged, map, switchMap, tap } from 'rxjs';

import { Params } from '@data-access/interfaces/core.interface';
import { IProduct } from '@data-access/interfaces/product.interface';
import { injectCatalogQuery } from '@data-access/queries/product.queries';
import { ProductService } from '@data-access/services/product.service';
import { Breadcrumb } from '@shared/ui/breadcrumb/breadcrumb';
import { Button } from '@shared/ui/button/button';
import { NoData } from '@shared/ui/no-data/no-data';
import { ProductBox } from '@shared/ui/product-box/product-box';
import { SkeletonProductBox } from '@shared/ui/product-box/skeleton-product-box/skeleton-product-box';
import { translatedBreadcrumb } from '@shared/util/breadcrumb-i18n';

import * as data from '../../../shared/data/owl-carousel';

@Component({
	selector: 'app-search',
	templateUrl: './search.html',
	styleUrls: ['./search.scss'],
	imports: [Breadcrumb, ReactiveFormsModule, Button, SkeletonProductBox, ProductBox, NoData, TranslocoModule],
})
export class Search {
	productService = inject(ProductService);
	private route = inject(ActivatedRoute);
	router = inject(Router);

	public breadcrumb = translatedBreadcrumb('search');

	public unavailable = signal(false);
	public search = new FormControl();
	public totalItems: number = 0;
	public gridClass: string = 'row g-sm-4 g-3 row-cols-2 row-cols-md-3 cols-lg-4 row-cols-xxl-6 product-list-section';
	public skeletonItems = Array.from({ length: 12 }, (_, index) => index);
	public productSlider6ItemMargin = data.productSlider6ItemMargin;
	public filter = signal<Params>({
		page: 1, // Current page number
		paginate: 100, // Display per page,
		status: 1,
		search: '',
	});

	private readonly productsQuery = injectCatalogQuery(() => this.filter());

	private readonly browser = isPlatformBrowser(inject(PLATFORM_ID));

	/** Results for the current term; null until they arrive. */
	private readonly results = signal<IProduct[] | null>(null);

	/** With no search term the page lists the catalogue. */
	readonly products = computed<IProduct[]>(() =>
		this.filter()['search'] ? (this.results() ?? []) : (this.productsQuery.data()?.data ?? []),
	);
	readonly loading = computed(() =>
		this.filter()['search'] ? this.results() === null : this.productsQuery.isFetching(),
	);

	constructor() {
		this.route.queryParams
			.pipe(
				map((params) => String(params['search'] ?? '')),
				tap((term) => {
					this.search.patchValue(term);
					this.filter.update((f) => ({ ...f, search: term }));
					this.results.set(null);
					this.unavailable.set(false);
				}),
				// switchMap drops an older term's answer that lands after a newer search.
				switchMap((term) =>
					// In the browser only: on the server every shopper would share one rate-limit address.
					term && this.browser
						? this.productService.search(term).pipe(
								catchError(() => {
									this.unavailable.set(true);
									return [[]];
								}),
							)
						: EMPTY,
				),
			)
			.subscribe((rows) => this.results.set(rows));
	}

	ngOnInit() {
		this.search.valueChanges
			.pipe(debounceTime(300), distinctUntilChanged()) // Adjust the debounce time as needed (in milliseconds)
			.subscribe((inputValue) => {
				if (inputValue.length == 0) {
					void this.router.navigate([], {
						relativeTo: this.route,
						queryParams: {
							search: inputValue,
						},
					});
					this.filter.update((f) => ({ ...f, search: inputValue }));
				}
			});
	}

	searchProduct() {
		void this.router.navigate([], {
			relativeTo: this.route,
			queryParams: {
				search: this.search.value,
			},
		});
		this.filter.update((f) => ({ ...f, search: this.search.value }));
	}
}
