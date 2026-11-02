import { AsyncPipe, NgClass, NgTemplateOutlet } from '@angular/common';
import { Component, computed, input } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';

import { Observable } from 'rxjs';

import { IProduct, IProductModel } from '@data-access/interfaces/product.interface';
import { bannerSrc, bannerSrcset } from '@data-access/queries/banner.queries';
import { injectProductsQuery } from '@data-access/queries/product.queries';

@Component({
	selector: 'app-image-link',
	templateUrl: './image-link.html',
	styleUrls: ['./image-link.scss'],
	imports: [NgClass, NgTemplateOutlet, RouterLink, AsyncPipe],
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
	/** The hero's first banner is the LCP image: eager and high priority. */
	readonly priority = input(false);
	/** Display width of this slot, so the browser picks the right file. */
	readonly sizes = input('100vw');

	readonly srcset = bannerSrcset;
	/** A hero's main banner is the page's LCP image in every layout. */
	readonly isHeroMain = (banner: { position: string; slot: string }) =>
		banner.position === 'hero' && banner.slot === 'main';
	readonly src = bannerSrc;

	constructor() {}

	getProductSlug(id: number, products: IProduct[] | undefined) {
		let product = products?.find((product) => product.id === id);
		return product ? product.slug : null;
	}
}
