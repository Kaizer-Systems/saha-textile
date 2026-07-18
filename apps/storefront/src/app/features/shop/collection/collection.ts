import { Component, computed, inject, signal } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';

import { Observable } from 'rxjs';

import { Params } from '@data-access/interfaces/core.interface';
import { IProductModel } from '@data-access/interfaces/product.interface';
import { injectProductsQuery } from '@data-access/queries/product.queries';
import { AttributeService } from '@data-access/services/attribute.service';
import * as data from '@shared/data/owl-carousel';
import { Breadcrumb } from '@shared/ui/breadcrumb/breadcrumb';
import { translatedBreadcrumb } from '@shared/util/breadcrumb-i18n';

import { CollectionCategories } from './widgets/collection-categories/collection-categories';
import { CollectionProducts } from './widgets/collection-products/collection-products';
import { CollectionSidebar } from './widgets/sidebar/sidebar';

@Component({
	selector: 'app-collection',
	templateUrl: './collection.html',
	styleUrls: ['./collection.scss'],
	imports: [Breadcrumb, CollectionCategories, CollectionSidebar, CollectionProducts],
})
export class Collection {
	private route = inject(ActivatedRoute);
	attributeService = inject(AttributeService);

	public filter = signal<Params>({
		page: 1, // Current page number
		paginate: 200, // Display per page, // Note we are using json thats why its it static
		status: 1,
		field: '',
		price: '',
		category: '',
		tag: '',
		sort: '', // ASC, DSC
		sortBy: '',
		rating: '',
		attribute: '',
	});

	private readonly productsQuery = injectProductsQuery(() => this.filter());
	product$: Observable<IProductModel | undefined> = toObservable(computed(() => this.productsQuery.data()));

	public breadcrumb = translatedBreadcrumb('collections');

	public categorySlider = data.categorySlider;
	public skeleton: boolean = true;

	public totalItems: number = 0;

	constructor() {
		// Get Query params..
		this.route.queryParams.subscribe((params) => {
			const next: Params = {
				page: params['page'] ? params['page'] : 1,
				paginate: 200, // Note we are using json thats why its it static
				status: 1,
				field: params['field'] ? params['field'] : this.filter()['field'],
				price: params['price'] ? params['price'] : '',
				category: params['category'] ? params['category'] : '',
				tag: params['tag'] ? params['tag'] : '',
				sort: params['sort'] ? params['sort'] : '',
				sortBy: params['sortBy'] ? params['sortBy'] : this.filter()['sortBy'],
				rating: params['rating'] ? params['rating'] : '',
				attribute: params['attribute'] ? params['attribute'] : '',
			};

			this.filter.set(next);
		});

		this.product$.subscribe((product) => (this.totalItems = product?.total ?? 0));
	}
}
