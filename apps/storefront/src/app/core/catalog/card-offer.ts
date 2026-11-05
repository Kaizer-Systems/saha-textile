import { IProduct, IVariation } from '@data-access/interfaces/product.interface';

export interface CardOffer {
	kind: 'single' | 'range';
	selling: number;
	mrp: number | null;
	percentOff: number | null;
	min: number;
	max: number;
	/** Translation key for the promotion slot, from the API. */
	primary: string | null;
	/** Translation key for the stock-fact slot, from the API. */
	secondary: string | null;
}

function sellingOf(variation: IVariation): number {
	return variation.sale_price || variation.price;
}

function mrpOf(variation: IVariation): number | null {
	const selling = sellingOf(variation);
	return variation.price > selling ? variation.price : null;
}

function buyable(variation: IVariation): boolean {
	return variation.stock_status !== 'out_of_stock' && variation.quantity > 0;
}

const badgeKey = (code: string | null | undefined): string | null => (code ? `badge_${code}` : null);

/** One price when selling price and MRP match. Otherwise a range and no percent. Badges come from the API. */
export function cardOffer(product: IProduct): CardOffer {
	const variations = product.variations ?? [];
	const rows = variations.length
		? variations
		: [
				{
					sale_price: product.sale_price,
					price: product.price,
					stock_status: product.stock_status,
					quantity: product.quantity,
				} as IVariation,
			];
	const live = rows.filter((row) => row.status !== false);
	const canBuy = live.filter(buyable);
	const counted = canBuy.length ? canBuy : live.length ? live : rows;
	const first = counted[0];
	const same = counted.every((row) => sellingOf(row) === sellingOf(first!) && mrpOf(row) === mrpOf(first!));
	const amounts = counted.map(sellingOf);
	const selling = first ? sellingOf(first) : product.sale_price;
	const mrp = first ? mrpOf(first) : product.price > product.sale_price ? product.price : null;
	const percentOff = mrp && mrp > selling ? Math.floor(((mrp - selling) / mrp) * 100) : null;
	return {
		kind: same ? 'single' : 'range',
		selling,
		mrp: same ? mrp : null,
		percentOff: same ? percentOff : null,
		min: Math.min(...amounts),
		max: Math.max(...amounts),
		primary: product.card_badges ? badgeKey(product.card_badges.primary) : demoPromotion(product),
		secondary: badgeKey(product.card_badges?.secondary),
	};
}

/** Widgets still reading the demo JSON have no API slots. They keep the old Sale or Featured tag. */
function demoPromotion(product: IProduct): string | null {
	if (product.is_sale_enable) return 'badge_sale';
	if (product.is_featured) return 'badge_featured';
	return null;
}
