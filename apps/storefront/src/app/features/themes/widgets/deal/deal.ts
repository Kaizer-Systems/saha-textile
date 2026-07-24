import { Component, computed, inject, input, SimpleChanges, viewChild } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';

import { TranslocoModule } from '@jsverse/transloco';
import { NgbRating, NgbRatingConfig } from '@ng-bootstrap/ng-bootstrap';
import { CarouselModule } from 'ngx-owl-carousel-o';
import { Observable } from 'rxjs';

import { CompareFacade } from '@core/state/compare/compare.store';
import { WishlistFacade } from '@core/state/wishlist/wishlist.store';
import { IProductModel } from '@data-access/interfaces/product.interface';
import { IDeal, IDealOfDays } from '@data-access/interfaces/theme.interface';
import { injectProductsQuery } from '@data-access/queries/product.queries';
import { CurrencySymbolPipe } from '@shared/pipes/currency-symbol.pipe';
import { ProductDetailModal } from '@shared/ui/modal/product-detail-modal/product-detail-modal';

import * as data from '../../../../shared/data/owl-carousel';

@Component({
	selector: 'app-deal',
	templateUrl: './deal.html',
	styleUrls: ['./deal.scss'],
	providers: [CurrencySymbolPipe],
	imports: [CarouselModule, NgbRating, CurrencySymbolPipe, TranslocoModule],
})
export class Deal {
	config = inject(NgbRatingConfig);
	private wishlistFacade = inject(WishlistFacade);
	private compareFacade = inject(CompareFacade);

	// TODO: Skipped for migration because:
	//  This input is used in a control flow expression (e.g. `@if` or `*ngIf`)
	//  and migrating would break narrowing currently.
	readonly data = input<IDealOfDays>();

	private readonly productsQuery = injectProductsQuery(() => undefined);
	product$: Observable<IProductModel | undefined> = toObservable(computed(() => this.productsQuery.data()));

	readonly productDetailModal = viewChild<ProductDetailModal>('productDetailModal');

	public dealSlider = data.singleSlider;
	public deals: IDeal[] = [];

	constructor() {
		const config = this.config;

		config.max = 5;
		config.readonly = true;
	}

	ngOnChanges(changes: SimpleChanges) {
		let dealsArray = changes['data']?.currentValue?.deals;
		this.product$.subscribe((products) => {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any -- vendor deal shape untyped pending state migration
			dealsArray.map((deal: any) => {
				deal.product = products?.data?.find((product) => product.id === deal.product_id);
			});
			this.deals = dealsArray;
			this.startTimers();
		});
	}

	startTimers() {
		for (let counterItem of this.deals) {
			const endDate = new Date(counterItem.end_date).getTime();
			const currentTime = new Date().getTime();
			const timeDifference = endDate - currentTime;

			if (timeDifference > 0) {
				counterItem.remainingTime = this.calculateRemainingTime(timeDifference);
				setInterval(() => {
					counterItem.remainingTime = this.calculateRemainingTime(endDate - new Date().getTime());
				}, 1000);
			}
		}
	}

	calculateRemainingTime(timeDifference: number) {
		const days = Math.floor(timeDifference / (1000 * 60 * 60 * 24));
		const hours = Math.floor((timeDifference % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
		const minutes = Math.floor((timeDifference % (1000 * 60 * 60)) / (1000 * 60));
		const seconds = Math.floor((timeDifference % (1000 * 60)) / 1000);
		return { days, hours, minutes, seconds };
	}

	addToWishlist(id: number) {
		this.wishlistFacade.addToWishlist({ product_id: id });
	}

	addToCompare(id: number) {
		this.compareFacade.addToCompare({ product_id: id });
	}
}
