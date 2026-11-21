import { Component, computed, input } from '@angular/core';

import { TranslocoModule } from '@jsverse/transloco';
import { NgbPopover } from '@ng-bootstrap/ng-bootstrap';

import { IAttributeValue } from '@data-access/interfaces/attribute.interface';
import { CurrencySymbolPipe } from '@shared/pipes/currency-symbol.pipe';
import { Button } from '@shared/ui/button/button';

import type { BuyBarHost } from './buy-bar-host';

/** One value in a chip's list: its stock with the other options as chosen now. */
export interface BarChoice {
	value: IAttributeValue;
	quantity: number;
	soldOut: boolean;
	chosen: boolean;
}

/** At or under this many left a value reads "Only N left" (the shop default, as the option table). */
const LOW_STOCK_AT = 2;

/**
 * The buy bar (owner, 21 Nov 2026, product page brief P4, section 7): one markup for every kind of product, a summary
 * line (photo, name, price) and an action line (quantity or length, Add to cart, Buy now; Notify me when sold out). It
 * reads and acts through the page's own buy box (drawn beside it, outside it, so the page keeps one set of buttons), so a choice made anywhere is the same choice in the cart. The page
 * reveals it with the theme's `stickyCart` switch: from the start on phones, on laptops whenever its buttons are out
 * of view.
 */
@Component({
	selector: 'app-buy-bar',
	templateUrl: './buy-bar.html',
	providers: [CurrencySymbolPipe],
	imports: [Button, CurrencySymbolPipe, TranslocoModule, NgbPopover],
})
export class BuyBar {
	/** The page's buy box: the bar reads its state and calls its buttons. */
	readonly host = input.required<BuyBarHost>();

	/** The chosen option's photo, else the product's. */
	readonly photo = computed(
		() =>
			this.host().summary()?.variation?.variation_image?.original_url ??
			this.host().product().product_thumbnail?.original_url ??
			'assets/images/product.png',
	);

	/**
	 * The chosen options as chips (brief P4, "Lavender ▾", "Size 34 ▾"), each with the values its list offers: their
	 * stock with the other options as chosen now; a value no variation has is left out.
	 */
	readonly axes = computed(() => {
		const product = this.host().product();
		const variations = product.variations ?? [];
		if (!product.attributes?.length || !variations.length) return [];
		const chosen = this.host().summary()?.variation?.attribute_values ?? [];
		return product.attributes.map((attribute) => {
			const others = chosen.filter((value) => value.attribute_id !== attribute.id);
			const pick = chosen.find((value) => value.attribute_id === attribute.id) ?? null;
			const values: BarChoice[] = attribute.attribute_values
				.filter((value) => variations.some((row) => row.attribute_values?.some((own) => own.id === value.id)))
				.map((value) => {
					const row = variations.find(
						(variation) =>
							variation.attribute_values?.some((own) => own.id === value.id) &&
							others.every((other) => variation.attribute_values?.some((own) => own.id === other.id)),
					);
					return {
						value,
						quantity: row?.quantity ?? 0,
						soldOut: !row || row.stock_status === 'out_of_stock',
						chosen: value.id === pick?.id,
					};
				});
			return { name: attribute.name, colour: COLOUR_STYLES.has(attribute.style), pick, values };
		});
	});

	readonly lowStock = LOW_STOCK_AT;

	choose(choice: BarChoice, popover: NgbPopover): void {
		popover.close();
		if (!choice.soldOut && !choice.chosen) this.host().chooseValue(choice.value);
	}
}

/** Looks drawn as colours, whose list shows each value's dot. */
const COLOUR_STYLES = new Set(['color', 'colour_chip']);
