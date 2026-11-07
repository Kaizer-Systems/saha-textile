import { AsyncPipe, ViewportScroller } from '@angular/common';
import { Component, computed, inject, input } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';

import { Observable } from 'rxjs';

import { ICatalogResponse } from '@data-access/interfaces/catalog.interface';
import { Params } from '@data-access/interfaces/core.interface';
import { injectCatalogQuery } from '@data-access/queries/product.queries';
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

	private readonly productsQuery = injectCatalogQuery(() => this.filter());
	product$: Observable<ICatalogResponse | undefined> = toObservable(computed(() => this.productsQuery.data()));

	/**
	 * Derived from the query signal. It used to be a plain field written inside a
	 * `toObservable` subscription, which nothing marks dirty after hydration — the same
	 * defect that once left the product page blank.
	 */
	public readonly totalItems = computed(() => this.productsQuery.data()?.total ?? 0);

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
