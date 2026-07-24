import { AsyncPipe, NgClass } from '@angular/common';
import { Component, computed, input } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';

import { Observable } from 'rxjs';

import { IProduct, IProductModel } from '@data-access/interfaces/product.interface';
import { injectProductsQuery } from '@data-access/queries/product.queries';

@Component({
	selector: 'app-image-link',
	templateUrl: './image-link.html',
	styleUrls: ['./image-link.scss'],
	imports: [NgClass, RouterLink, AsyncPipe],
})
export class ImageLink {
	private readonly productsQuery = injectProductsQuery(() => undefined);
	product$: Observable<IProductModel | undefined> = toObservable(computed(() => this.productsQuery.data()));

	// TODO: Skipped for migration because:
	//  This input is used in a control flow expression (e.g. `@if` or `*ngIf`)
	//  and migrating would break narrowing currently.
	// eslint-disable-next-line @typescript-eslint/no-explicit-any -- intentional migration skip (template control-flow narrowing)
	readonly image = input<any>();
	readonly link = input<string>();
	readonly bgImage = input<boolean>();
	readonly class = input<string>();

	constructor() {}

	getProductSlug(id: number, products: IProduct[] | undefined) {
		let product = products?.find((product) => product.id === id);
		return product ? product.slug : null;
	}
}
