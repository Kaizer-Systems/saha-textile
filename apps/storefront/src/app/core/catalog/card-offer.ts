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
	/** The stock fact on the photo, from the API. */
	chip: StockChip | null;
}

/** One small chip on the card photo. `tone` picks its colour. */
export interface StockChip {
	key: string;
	count: number;
	tone: 'critical' | 'low' | 'back';
}

/** Low stock names the pieces left, so the last piece reads red. */
function stockChip(product: IProduct): StockChip | null {
	const fact = product.card_badges?.secondary;
	if (fact === 'back_in_stock') return { key: 'badge_back_in_stock', count: 0, tone: 'back' };
	if (fact !== 'low_stock') return null;
	const count = product.card_badges?.left ?? 0;
	return { key: 'badge_low_stock_left', count, tone: count === 1 ? 'critical' : 'low' };
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
	const first = counted[0] as IVariation;
	const same = counted.every((row) => sellingOf(row) === sellingOf(first) && mrpOf(row) === mrpOf(first));
	const amounts = counted.map(sellingOf);
	const selling = sellingOf(first);
	const mrp = mrpOf(first);
	const percentOff = mrp && mrp > selling ? Math.floor(((mrp - selling) / mrp) * 100) : null;
	return {
		kind: same ? 'single' : 'range',
		selling,
		mrp: same ? mrp : null,
		percentOff: same ? percentOff : null,
		min: Math.min(...amounts),
		max: Math.max(...amounts),
		primary: product.card_badges ? badgeKey(product.card_badges.primary) : demoPromotion(product),
		chip: stockChip(product),
	};
}

/** Widgets still reading the demo JSON have no API slots. They keep the old Sale or Featured tag. */
function demoPromotion(product: IProduct): string | null {
	if (product.is_sale_enable) return 'badge_sale';
	if (product.is_featured) return 'badge_featured';
	return null;
}
