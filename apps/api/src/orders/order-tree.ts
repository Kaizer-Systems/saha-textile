import type { CartViewChild, OrderLine } from '@saha-textile/contracts';
import { orderChildMoney } from '@saha-textile/core-domain';

/**
 * A cart line as an order's line tree (bundle builder brief E05–E09, approved 2026-11-22), shared by the shop
 * checkout and staff orders: a set's own line holds no money, stock or tax; its pieces at their shares, their free
 * items at ₹0 and its extras carry them; a product's free items sit under the product.
 */
export interface TreeLine {
	/** The cart line's id; child lines are named `${id}~${childKey}`. */
	id: string;
	productId: string;
	variationId: string | null;
	quantity: number;
	soldBy?: 'piece' | 'metre';
	unitPriceINR: number;
	mrpINR: number | null;
	setHeading?: 'components' | 'choose' | null;
	children?: readonly CartViewChild[];
}

/** Whether a line keeps pieces in stock: a set's own line never does (its pieces do), nor made-to-order work. */
export function keepsStock(line: OrderLine): boolean {
	return line.role !== 'bundle' && !line.madeToOrder;
}

/** What goes in the parcel, line by line, with the cart line each came from. */
export function parcelUnits(lines: readonly TreeLine[]) {
	return lines.flatMap((line, cartIndex) => {
		const per = line.soldBy === 'metre' ? 1 : Math.min(99, line.quantity);
		const own = line.setHeading
			? []
			: [{ cartIndex, productId: line.productId, variationId: line.variationId, quantity: per }];
		// Lines read before sets existed carry no children.
		const children = (line.children ?? []).map((child) => ({
			cartIndex,
			productId: child.productId,
			variationId: child.variantId,
			quantity: Math.min(99, child.quantity * per),
		}));
		return [...own, ...children];
	});
}

/**
 * A set's own line (bundle builder brief E05–E08): its name, picture and quantity, with no money of its own; the
 * set price and what its pieces cost separately ride along for the order pages' "You save". Other lines pass as
 * they are.
 */
export function setLine(own: OrderLine, line: TreeLine): OrderLine[] {
	if (!line.setHeading) return [own];
	return [
		{
			...own,
			role: 'bundle',
			unitPriceINR: 0,
			unitPricePaid: 0,
			lineTotalINR: 0,
			lineTotalPaid: 0,
			couponINR: 0,
			pricing: undefined,
			set: { heading: line.setHeading, priceINR: line.unitPriceINR, separatelyINR: line.mrpINR },
		},
	];
}

/** The children under a line: a set's pieces, their free items and its extras, or a product's own free items. */
export function childLines(
	line: TreeLine,
	parent: OrderLine,
	convert: (amountINR: number) => number,
	couponINR: number,
	at: string,
): OrderLine[] {
	if (!line.children?.length) return [];
	const idOf = (key: string) => `${line.id}~${key}`;
	const money = orderChildMoney(
		line.children.map(({ role, key, quantity, priceINR }) => ({ role, key, quantity, priceINR })),
		line.quantity,
		line.setHeading ? couponINR : 0,
	);
	return line.children.map((child, at2) => {
		const row = money[at2];
		const unitPriceINR = row?.unitPriceINR ?? 0;
		const lineTotalINR = row?.lineTotalINR ?? 0;
		return {
			lineId: idOf(child.key),
			productId: child.productId,
			variationId: child.variantId,
			title: { en: child.title },
			sku: child.sku || child.productId,
			quantity: row?.quantity ?? child.quantity * line.quantity,
			attributes: (child.variantLabel ? { Variation: child.variantLabel } : {}) as Record<string, string>,
			addons: [],
			imageAssetId: child.image?.assetId ?? null,
			imageUrl: child.image?.roles['card']?.[0]?.url ?? null,
			unitPriceINR,
			unitPricePaid: convert(unitPriceINR),
			lineTotalINR,
			lineTotalPaid: convert(lineTotalINR),
			pricing: {
				regularUnitINR: unitPriceINR,
				mrpUnitINR: child.mrpINR !== null && child.mrpINR > unitPriceINR ? child.mrpINR : null,
				saleUnitINR: null,
				saleEventId: null,
				zoneRule: null,
				discounted: false,
				addOnsZonePriced: false,
			},
			couponINR: row?.couponINR ?? 0,
			categoryIds: [],
			held: false,
			addedAt: at,
			addedBy: null,
			role: child.role,
			// A free item sits under the piece it comes with; everything else under the line itself.
			parentLineId: child.parentKey ? idOf(child.parentKey) : (parent.lineId ?? null),
			set: null,
		};
	});
}
