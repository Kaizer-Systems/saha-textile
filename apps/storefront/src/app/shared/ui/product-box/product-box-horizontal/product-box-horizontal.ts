import { Component, computed, inject, viewChild, input } from '@angular/core';
import { RouterLink } from '@angular/router';

import { TranslocoModule } from '@jsverse/transloco';
import { NgbRatingConfig, NgbRating } from '@ng-bootstrap/ng-bootstrap';
import { Observable } from 'rxjs';

import { cardOffer } from '@core/catalog/card-offer';
import { roleSrcset } from '@core/media/resolved-image';
import { CartFacade } from '@core/state/cart/cart.facade';
import { CompareFacade } from '@core/state/compare/compare.store';
import { WishlistFacade } from '@core/state/wishlist/wishlist.store';
import { ICartAddOrUpdate, ICart } from '@data-access/interfaces/cart.interface';
import { IProduct } from '@data-access/interfaces/product.interface';
import { CurrencySymbolPipe } from '@shared/pipes/currency-symbol.pipe';
import { TitleCasePipe } from '@shared/pipes/title-case.pipe';
import { ProductConfigModal } from '@shared/ui/modal/product-config-modal/product-config-modal';
import { ProductDetailModal } from '@shared/ui/modal/product-detail-modal/product-detail-modal';

import { Button } from '../../button/button';

/** Rendered card width per breakpoint: 2 columns on phones, ~206 px in desktop rails and grids. */
const CARD_SIZES = '(max-width: 575px) 48vw, (max-width: 991px) 33vw, 240px';

@Component({
	selector: 'app-product-box-horizontal',
	templateUrl: './product-box-horizontal.html',
	styleUrls: ['./product-box-horizontal.scss'],
	providers: [CurrencySymbolPipe],
	imports: [
		RouterLink,
		Button,
		NgbRating,
		ProductDetailModal,
		ProductConfigModal,
		TranslocoModule,
		TitleCasePipe,
		CurrencySymbolPipe,
	],
})
export class ProductBoxHorizontal {
	private wishlistFacade = inject(WishlistFacade);
	private compareFacade = inject(CompareFacade);
	private cartFacade = inject(CartFacade);

	// TODO: Skipped for migration because:
	//  This input is used in a control flow expression (e.g. `@if` or `*ngIf`)
	//  and migrating would break narrowing currently.
	readonly product = input<IProduct>();
	readonly imagePriority = input<'high' | 'low' | 'lazy'>('lazy');
	readonly offer = cardOffer;
	readonly class = input<string>();
	readonly close = input<boolean>();

	/** The pipeline's `card` widths, so a phone downloads the 400 px file and a retina desktop the 700. */
	readonly thumbnail = computed(() => {
		const image = this.product()?.product_thumbnail?.image;
		const srcset = roleSrcset(image, 'card');
		return {
			srcset,
			sizes: srcset ? CARD_SIZES : null,
			width: image?.width ?? null,
			height: image?.height ?? null,
		};
	});

	cartItem$: Observable<ICart[]> = this.cartFacade.cartItems$;

	readonly productDetailModal = viewChild<ProductDetailModal>('productDetailModal');
	readonly configModal = viewChild<ProductConfigModal>('configModal');

	public cartItem: ICart | null;
	public currentDate: number | null;
	public saleStartDate: number | null;

	constructor() {
		const config = inject(NgbRatingConfig);

		config.max = 5;
		config.readonly = true;
	}

	ngOnInit() {
		this.cartItem$.subscribe((items) => {
			this.cartItem = items.find((item) => item.product.id == this.product()?.id)!;
		});
	}

	/** Needs a configurator (variation axis / add-on / bundle) rather than a blind one-click add. */
	isConfigurable(product: IProduct | undefined): boolean {
		if (!product) return false;
		return (
			!!(product.attributes?.length && product.variations?.length) ||
			!!product.addon_groups?.length ||
			!!product.bundle
		);
	}

	addToCart(product: IProduct, qty: number) {
		const params: ICartAddOrUpdate = {
			id: this.cartItem ? this.cartItem.id : null,
			product: product,
			product_id: product?.id,
			variation_id: this.cartItem ? this.cartItem?.variation_id : null,
			variation: this.cartItem ? this.cartItem?.variation : null,
			quantity: qty,
		};
		this.cartFacade.addToCart(params);
	}

	addToWishlist(id: number | string) {
		this.wishlistFacade.addToWishlist({ product_id: id });
	}

	removeWishlist(id: number | string) {
		this.wishlistFacade.deleteWishlist(id);
	}

	addToCompar(id: number | string) {
		this.compareFacade.addToCompare({ product_id: id });
	}
}
