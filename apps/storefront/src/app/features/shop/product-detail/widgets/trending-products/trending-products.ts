import { SlicePipe } from '@angular/common';
import { Component, computed } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';

import { TranslocoModule } from '@jsverse/transloco';
import { Observable } from 'rxjs';

import { IProduct } from '@data-access/interfaces/product.interface';
import { injectRelatedProductsData } from '@data-access/queries/product.queries';
import { ProductBox } from '@shared/ui/product-box/product-box';

@Component({
	selector: 'app-trending-products',
	templateUrl: './trending-products.html',
	styleUrls: ['./trending-products.scss'],
	imports: [ProductBox, SlicePipe, TranslocoModule],
})
export class TrendingProducts {
	private readonly relatedQuery = injectRelatedProductsData();
	relatedProduct$: Observable<IProduct[]> = toObservable(computed(() => this.relatedQuery.data() ?? []));

	public relatedProducts: IProduct[] = [];

	ngOnInit() {
		this.relatedProduct$.subscribe((products) => {
			this.relatedProducts = products.length ? products?.filter((product) => product?.is_trending) : [];
		});
	}
}
