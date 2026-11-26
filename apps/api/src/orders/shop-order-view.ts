import type { Order, ShopOrderLine, ShopOrderSummary, ShopOrderView } from '@saha-textile/contracts';

const round2 = (value: number) => Math.round(value * 100) / 100;

/** A set's line shows what its children cost together, in the currency paid (its own line holds no money). */
function setTotal(order: Order, lineId: string | undefined): number {
	return round2(
		order.lines
			.filter((row) => lineId && row.parentLineId === lineId)
			.reduce((sum, row) => sum + row.lineTotalPaid, 0),
	);
}

function line(order: Order, row: Order['lines'][number]): ShopOrderLine {
	const isSet = row.role === 'bundle';
	const total = isSet ? setTotal(order, row.lineId) : row.lineTotalPaid;
	const rupees = order.currency === 'INR';
	const saved =
		isSet && rupees && row.set?.separatelyINR != null
			? round2(Math.max(0, row.set.separatelyINR * row.quantity - total))
			: null;
	return {
		lineId: row.lineId ?? row.sku,
		parentLineId: row.parentLineId,
		role: row.role,
		title: row.title['en'] ?? Object.values(row.title)[0] ?? row.sku,
		details: [
			...Object.values(row.attributes ?? {}),
			...(row.addons ?? []).map((addon) => `${addon.label ?? addon.code}: ${addon.value}`),
		],
		quantity: row.quantity,
		unitPrice: isSet ? round2(total / row.quantity) : row.unitPricePaid,
		lineTotal: total,
		mrp: row.role === 'free' && rupees ? (row.pricing?.mrpUnitINR ?? null) : null,
		imageUrl: row.imageUrl ?? null,
		set: isSet && row.set ? { heading: row.set.heading, saved: saved && saved > 0 ? saved : null } : null,
	};
}

/** What the list shows of one order. */
export function shopOrderSummary(order: Order): ShopOrderSummary {
	const first = order.lines.find((row) => !row.parentLineId);
	const count = (role: string) => order.lines.filter((row) => row.role === role).length;
	return {
		orderNumber: order.orderNumber,
		placedAt: order.createdAt ?? null,
		status: order.status,
		currency: order.currency,
		total: order.totalPaid,
		sets: count('bundle'),
		products: order.lines.filter((row) => row.role === 'product').length,
		pieces: order.lines.filter((row) => row.role !== 'bundle').reduce((sum, row) => sum + row.quantity, 0),
		freeItems: order.lines.filter((row) => row.role === 'free').reduce((sum, row) => sum + row.quantity, 0),
		firstTitle: first ? (first.title['en'] ?? first.sku) : '',
		firstImageUrl: first?.imageUrl ?? null,
		thumbs: thumbs(order),
		statusAt: order.statusTimeline.findLast((event) => event.status === order.status)?.at ?? null,
	};
}

/** One picture per line of its own (a set without its own picture shows its first piece's), at most four, no repeats. */
function thumbs(order: Order): string[] {
	const out: string[] = [];
	for (const row of order.lines.filter((line) => !line.parentLineId)) {
		const image = row.imageUrl ?? order.lines.find((line) => line.parentLineId === row.lineId)?.imageUrl ?? null;
		if (image && !out.includes(image)) out.push(image);
		if (out.length === 4) break;
	}
	return out;
}

/** One order as its shopper sees it (E05): the tree, the money, the steps so far and where it is going. */
export function shopOrderView(order: Order): ShopOrderView {
	const delivery = order.addresses?.delivery ?? null;
	const phone = delivery?.mobile ? `+${delivery.mobile.countryCallingCode} ${delivery.mobile.number}` : null;
	const goods = round2(order.lines.reduce((sum, row) => sum + row.lineTotalPaid, 0));
	const shipping = order.shipping?.value ?? 0;
	return {
		...shopOrderSummary(order),
		lines: order.lines.map((row) => line(order, row)),
		goods,
		// Coupons are kept in rupees; in the currency paid they are what the goods and delivery came to less the total.
		coupon: round2(Math.max(0, goods + shipping - order.totalPaid)),
		shipping,
		steps: order.statusTimeline.map((event) => ({ status: event.status, at: event.at })),
		delivery: delivery
			? {
					name: delivery.fullName,
					address: [delivery.line1, delivery.line2, delivery.city, delivery.state, delivery.postalCode]
						.filter((part) => part && part.trim())
						.join(', '),
					phone,
				}
			: null,
	};
}
