import { AsyncPipe } from '@angular/common';
import { Component, computed, effect, inject, input } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';

import { TranslocoModule } from '@jsverse/transloco';
import { Observable } from 'rxjs';

import { ICatalogResponse } from '@data-access/interfaces/catalog.interface';
import { Params } from '@data-access/interfaces/core.interface';
import { injectCatalogQuery } from '@data-access/queries/product.queries';
import { ProductService } from '@data-access/services/product.service';
import { NoData } from '@shared/ui/no-data/no-data';
import { ProductBox } from '@shared/ui/product-box/product-box';
import { SkeletonProductBox } from '@shared/ui/product-box/skeleton-product-box/skeleton-product-box';

import { CollectionPaginate } from '../collection-paginate/collection-paginate';
import { CollectionSort } from '../collection-sort/collection-sort';

@Component({
	selector: 'app-collection-products',
	templateUrl: './collection-products.html',
	styleUrls: ['./collection-products.scss'],
	imports: [CollectionSort, SkeletonProductBox, ProductBox, NoData, CollectionPaginate, AsyncPipe, TranslocoModule],
})
export class CollectionProducts {
	productService = inject(ProductService);

	readonly filter = input<Params>();
	readonly gridCol = input<string>();

	private readonly productsQuery = injectCatalogQuery(() => this.filter());
	product$: Observable<ICatalogResponse | undefined> = toObservable(computed(() => this.productsQuery.data()));

	constructor() {
		// Drive the shared skeleton flag off the query's fetch state (was toggled by
		// the old GetProductsAction reducer).
		effect(() => (this.productService.skeletonLoader = this.productsQuery.isFetching()));
	}

	public gridClass: string =
		'row g-sm-4 g-3 row-cols-xxl-4 row-cols-xl-3 row-cols-lg-2 row-cols-md-3 row-cols-2 product-list-section';

	public skeletonItems = Array.from({ length: 40 }, (_, index) => index);

	setGridClass(gridClass: string) {
		this.gridClass = gridClass;
	}
}
