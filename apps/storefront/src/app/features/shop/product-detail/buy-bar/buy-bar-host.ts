import type { Signal } from '@angular/core';

import { IAttributeValue } from '@data-access/interfaces/attribute.interface';
import { IConfiguratorSummary } from '@data-access/interfaces/product-detail.interface';
import { IProduct } from '@data-access/interfaces/product.interface';

/** What the buy bar reads from, and asks of, the page's own buy box: the bar shows the page's choices, never its own. */
export interface BuyBarHost {
	product: Signal<IProduct>;
	summary: Signal<IConfiguratorSummary | null>;
	displayPrice: Signal<number>;
	comparePrice: Signal<number>;
	discount: Signal<number>;
	purchasable: Signal<boolean>;
	soldOut: Signal<boolean>;
	rule: Signal<unknown>;
	length: Signal<number>;
	productQty: number;
	lengthOf(tenths: number): string;
	updateQuantity(by: number): void;
	addToCart(): void;
	buyNow(): void;
	notify(): void;
	chooseValue(value: IAttributeValue): void;
}
