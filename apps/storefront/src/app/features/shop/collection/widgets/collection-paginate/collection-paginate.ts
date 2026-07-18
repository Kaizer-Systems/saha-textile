import { AsyncPipe, ViewportScroller } from '@angular/common';
import { Component, computed, inject, input } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';

import { Observable } from 'rxjs';

import { Params } from '@data-access/interfaces/core.interface';
import { IProductModel } from '@data-access/interfaces/product.interface';
import { injectProductsQuery } from '@data-access/queries/product.queries';
import { Pagination } from '@shared/ui/pagination/pagination';

@Component({
	selector: 'app-collection-paginate',
	templateUrl: './collection-paginate.html',
	styleUrls: ['./collection-paginate.scss'],
	imports: [Pagination, AsyncPipe],
})
export class CollectionPaginate {
	private route = inject(ActivatedRoute);
	private router = inject(Router);
	private viewScroller = inject(ViewportScroller);

	readonly filter = input<Params>();

	private readonly productsQuery = injectProductsQuery(() => this.filter());
	product$: Observable<IProductModel | undefined> = toObservable(computed(() => this.productsQuery.data()));

	public totalItems: number = 0;

	constructor() {
		this.product$.subscribe((product) => (this.totalItems = product?.total ?? 0));
	}

	setPaginate(page: number) {
		void this.router
			.navigate([], {
				relativeTo: this.route,
				queryParams: {
					page: page,
				},
				queryParamsHandling: 'merge', // preserve the existing query params in the route
				skipLocationChange: false, // do trigger navigation
			})
			.finally(() => {
				// this.viewScroller.setOffset([100, 100]);
				// this.viewScroller.scrollToAnchor('filtered_products'); // Anchor Link
			});
	}
}
