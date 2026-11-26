import { Component, computed, inject, input, output } from '@angular/core';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';

import { money } from '@core/orders/order-format';

import type { AdminProductCard } from '@saha-textile/contracts';

/** Stock as the card says it: "1 left", "4 in stock", "2.5 m in stock" (fabric counts tenths of a metre). */
export function stockWords(
	card: Pick<AdminProductCard, 'stock' | 'soldBy'>,
	translate: (key: string, params?: object) => string,
): string {
	if (card.stock === null) return '';
	if (card.soldBy === 'metre')
		return translate('ord_card_metres', { metres: (card.stock / 10).toLocaleString('en-IN') });
	if (card.stock === 1) return translate('ord_card_one_left');
	return translate('ord_card_in_stock', { count: card.stock });
}

/**
 * One product on Create order (oc01–oc03), a copy of the theme's product box (`shared/ui/product-box`)
 * for the server's zone-priced cards. A product the business's zone has no price for is greyed, says
 * "Price not set for this zone" in red, and can't be added (owner, 2026-11-20).
 */
@Component({
	selector: 'app-order-product-card',
	template: `
		@let item = card();
		<div
			class="product-box"
			[class.opacity-50]="noPrice()"
			[class.pe-none]="noPrice()"
			[attr.aria-disabled]="noPrice()"
		>
			<div class="product-image">
				<img
					[src]="item.imageUrl ?? 'assets/images/product.png'"
					class="img-fluid"
					alt=""
				/>
			</div>
			<div class="product-detail">
				<h6 class="name name-2 h-100">{{ item.title }}</h6>
				<h6 class="sold weight text-content fw-normal">{{ stock() }}</h6>
				<div class="counter-box">
					@if (noPrice()) {
						<h6 class="sold text-danger">{{ 'ord_zone_no_price' | transloco }}</h6>
					} @else {
						<h6 class="sold theme-color">{{ price() }}</h6>
						<div class="addtocart_btn">
							<button
								type="button"
								class="add-button addcart-button btn buy-button"
								[class.disabled]="soldOut()"
								[disabled]="soldOut()"
								(click)="add.emit(item)"
							>
								@if (soldOut()) {
									{{ 'out_of_stock' | transloco }}
								} @else if (card().isBundle) {
									<i class="ri-equalizer-line"></i>
									{{ 'ord_set_configure' | transloco }}
								} @else {
									<i class="ri-add-line"></i>
									{{ 'add' | transloco }}
								}
							</button>
						</div>
					}
				</div>
			</div>
		</div>
	`,
	imports: [TranslocoModule],
})
export class OrderProductCard {
	private readonly transloco = inject(TranslocoService);

	readonly card = input.required<AdminProductCard>();
	readonly currency = input('INR');
	readonly add = output<AdminProductCard>();

	readonly noPrice = computed(() => this.card().price === null);
	/** A product with variants is chosen in the variant popup, where each variant shows its own stock. */
	readonly soldOut = computed(() => !this.card().hasVariants && this.card().stock === 0);
	readonly price = computed(() => {
		const amount = this.card().price ?? 0;
		const text = money(amount, this.currency(), this.transloco.getActiveLang() === 'bn' ? 'bn-IN' : 'en-IN');
		return this.card().soldBy === 'metre' ? this.transloco.translate('ord_per_metre', { price: text }) : text;
	});
	readonly stock = computed(() =>
		// A set's stock is worked out from its pieces: "4 sets possible" (bundle builder brief E09).
		this.card().isBundle
			? this.transloco.translate('ord_card_sets_possible', { count: this.card().setsPossible ?? 0 })
			: this.card().hasVariants
				? this.transloco.translate('ord_card_choose_variant')
				: stockWords(this.card(), (key, params) => this.transloco.translate(key, params)),
	);
}
