import { Component, effect, inject, signal } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';

import { TranslocoModule } from '@jsverse/transloco';
import { debounceTime, distinctUntilChanged } from 'rxjs';

import { Params } from '@data-access/interfaces/core.interface';
import { IProduct } from '@data-access/interfaces/product.interface';
import { injectProductsQuery } from '@data-access/queries/product.queries';
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

	public products: IProduct[];
	public search = new FormControl();
	public totalItems: number = 0;
	public gridClass: string = 'row g-sm-4 g-3 row-cols-2 row-cols-md-3 cols-lg-4 row-cols-xxl-6 product-list-section';
	public skeletonItems = Array.from({ length: 12 }, (_, index) => index);
	public productSlider6ItemMargin = data.productSlider6ItemMargin;
	public filter = signal<Params>({
		page: 1, // Current page number
		paginate: 200, // Display per page,
		status: 1,
		search: '',
	});

	private readonly productsQuery = injectProductsQuery(() => this.filter());

	constructor() {
		// Search filter drives the query; results + skeleton flag mirror its state
		// (was a GetProductsAction dispatch reading the NGXS snapshot).
		effect(() => (this.products = this.productsQuery.data()?.data ?? []));
		effect(() => (this.productService.skeletonLoader = this.productsQuery.isFetching()));

		this.route.queryParams.subscribe((params) => {
			if (params['search']) {
				this.filter.update((f) => ({ ...f, search: params['search'] }));
				this.search.patchValue(params['search'] ? params['search'] : '');
			}
		});
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
