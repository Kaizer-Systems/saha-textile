import { type QuoteBundle, type QuoteItem } from '@saha-textile/core-domain/bundle';

import { IBundle, ISetItem } from '@data-access/interfaces/product-detail.interface';

const quoteItem = (item: ISetItem): QuoteItem => ({
	key: item.key,
	quantity: item.quantity,
	priceInSetINR: item.price_in_set,
	todayINR: item.today,
	onSale: item.sale !== null,
	perTenth: item.sold_by === 'metre',
});

/**
 * A set in the shape core's engine prices (bundle builder brief, approved 2026-11-22). The page prices each choice
 * with `quoteBundle` from the same method and rules the API and checkout use, so the shopper pays what they see.
 */
export function setQuote(bundle: IBundle): QuoteBundle {
	const pricing = bundle.pricing;
	return {
		levels: bundle.levels.map((level) => ({
			code: level.code,
			take: level.take,
			priceMode: level.price_mode,
			items: level.items.map(quoteItem),
		})),
		extras: bundle.extras.map(quoteItem),
		method: {
			base: pricing.base,
			inputs: pricing.inputs,
			rules: pricing.methodRules,
			combine: pricing.methodCombine,
		},
		params: pricing.params,
		rules: pricing.rules,
		combine: pricing.combine,
		capAtSeparately: pricing.capAtSeparately,
		roundTo: pricing.roundTo,
	};
}
