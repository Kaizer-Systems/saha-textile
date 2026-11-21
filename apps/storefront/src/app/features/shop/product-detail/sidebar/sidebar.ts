import { AsyncPipe } from '@angular/common';
import { Component, inject, input } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';

import { Observable } from 'rxjs';

import { SiteConfigStore } from '@core/state/site-config.store';
import { IProduct } from '@data-access/interfaces/product.interface';
import { ISiteConfig } from '@data-access/interfaces/site-config.interface';
import { SetSummary } from '@shared/ui/product-config/parts/set-summary/set-summary';

import { StoreInformation } from '../widgets/store-information/store-information';
import { TrendingProducts } from '../widgets/trending-products/trending-products';

@Component({
	selector: 'app-product-details-sidebar',
	templateUrl: './sidebar.html',
	styleUrls: ['./sidebar.scss'],
	imports: [StoreInformation, TrendingProducts, AsyncPipe, SetSummary],
})
export class ProductSidebar {
	siteConfig$: Observable<ISiteConfig> = toObservable(inject(SiteConfigStore).siteConfig) as Observable<ISiteConfig>;

	// TODO: Skipped for migration because:
	//  This input is used in a control flow expression (e.g. `@if` or `*ngIf`)
	//  and migrating would break narrowing currently.
	readonly product = input<IProduct>();
	/** On a set page: the set price with its chosen options, and how many sets the buy box holds (brief P8). */
	readonly setPrice = input<number | null>(null);
	readonly quantity = input(1);
	readonly buyable = input(true);
}
