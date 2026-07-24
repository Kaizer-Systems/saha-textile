import { Component, computed, input } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';

import { Observable } from 'rxjs';

import { IProductModel } from '@data-access/interfaces/product.interface';
import { ISliderProductsTokyo } from '@data-access/interfaces/theme.interface';
import { injectProductsQuery } from '@data-access/queries/product.queries';

import { Product } from '../product/product';

@Component({
	selector: 'app-four-column-product',
	templateUrl: './four-column-product.html',
	styleUrls: ['./four-column-product.scss'],
	imports: [Product],
})
export class FourColumnProduct {
	// TODO: Skipped for migration because:
	//  This input is used in a control flow expression (e.g. `@if` or `*ngIf`)
	//  and migrating would break narrowing currently.
	readonly data = input<ISliderProductsTokyo>();
	// TODO: Skipped for migration because:
	//  This input is used in a control flow expression (e.g. `@if` or `*ngIf`)
	//  and migrating would break narrowing currently.
	readonly col = input<string>();

	private readonly productsQuery = injectProductsQuery(() => undefined);
	product$: Observable<IProductModel | undefined> = toObservable(computed(() => this.productsQuery.data()));
}
