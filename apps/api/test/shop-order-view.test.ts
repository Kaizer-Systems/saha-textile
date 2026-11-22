import { Order } from '@saha-textile/contracts';
import { describe, expect, it } from 'vitest';

import { OrdersService } from '../src/orders/orders.service';
import { shopOrderSummary, shopOrderView } from '../src/orders/shop-order-view';

const line = (over: Record<string, unknown>) => ({
	productId: 'p',
	title: { en: 'Piece' },
	sku: 'SKU',
	quantity: 1,
	unitPriceINR: 0,
	unitPricePaid: 0,
	lineTotalINR: 0,
	lineTotalPaid: 0,
	...over,
});
const order = Order.parse({
	id: 'ord_1',
	orderNumber: 'ST-2611-482190',
	userId: 'cus_1',
	currency: 'INR',
	status: 'processing',
	createdAt: '2026-11-22T05:10:00.000Z',
	lines: [
		line({
			lineId: 's',
			productId: 'set1',
			role: 'bundle',
			title: { en: 'Peacock set' },
			imageUrl: 'set.jpg',
			set: { heading: 'components', priceINR: 44900, separatelyINR: 48400 },
		}),
		line({ lineId: 's~a', role: 'piece', parentLineId: 's', unitPricePaid: 33211.16, lineTotalPaid: 33211.16 }),
		line({
			lineId: 's~a>f',
			role: 'free',
			parentLineId: 's~a',
			title: { en: 'Petticoat' },
			attributes: { Variation: 'M' },
			pricing: { regularUnitINR: 0, mrpUnitINR: 799 },
		}),
		line({ lineId: 's~b', role: 'piece', parentLineId: 's', unitPricePaid: 11688.84, lineTotalPaid: 11688.84 }),
		line({
			lineId: 'p',
			title: { en: 'Lavender saree' },
			unitPricePaid: 5600,
			lineTotalPaid: 5600,
			addons: [{ code: 'd', label: 'Blouse design', value: 'Boat Neck' }],
		}),
	],
	subtotalINR: 50500,
	subtotalPaid: 50500,
	totalINR: 50000,
	totalPaid: 50000,
	shipping: { value: 0, currency: 'INR' },
	statusTimeline: [{ status: 'placed', at: '2026-11-22T05:11:00.000Z' }],
	addresses: {
		billing: { fullName: 'Priya Sharma', line1: '14/2 Lake Road', city: 'Kolkata', country: 'IN' },
		delivery: {
			fullName: 'Priya Sharma',
			line1: '14/2 Lake Road',
			city: 'Kolkata',
			state: 'West Bengal',
			postalCode: '700029',
			country: 'IN',
			mobile: { countryCallingCode: '91', number: '9830012345' },
		},
		billingSameAsDelivery: true,
		invoice: { source: 'billing', address: null, needed: false },
	},
	history: [
		{ at: '2026-11-22T05:10:00.000Z', by: 'staff_1', byName: 'Staff', kind: 'comment', comment: 'internal note' },
	],
});

describe('a shopper’s own orders (bundle builder brief E05–E06)', () => {
	it('counts sets, products, pieces and free items for the list', () => {
		expect(shopOrderSummary(order)).toMatchObject({
			orderNumber: 'ST-2611-482190',
			sets: 1,
			products: 1,
			pieces: 4,
			freeItems: 1,
			firstTitle: 'Peacock set',
			firstImageUrl: 'set.jpg',
			total: 50000,
		});
	});

	it('shows the tree with the set priced from its pieces, the saving, a free item’s MRP, and the coupon', () => {
		const view = shopOrderView(order);
		expect(view.lines.map((row) => [row.lineId, row.role, row.unitPrice, row.mrp])).toEqual([
			['s', 'bundle', 44900, null],
			['s~a', 'piece', 33211.16, null],
			['s~a>f', 'free', 0, 799],
			['s~b', 'piece', 11688.84, null],
			['p', 'product', 5600, null],
		]);
		expect(view.lines[0]?.set).toEqual({ heading: 'components', saved: 3500 });
		expect(view.lines[2]?.details).toEqual(['M']);
		expect(view.lines[4]?.details).toEqual(['Blouse design: Boat Neck']);
		expect(view).toMatchObject({ goods: 50500, coupon: 500, shipping: 0 });
		expect(view.delivery).toEqual({
			name: 'Priya Sharma',
			address: '14/2 Lake Road, Kolkata, West Bengal, 700029',
			phone: '+91 9830012345',
		});
		expect(JSON.stringify(view)).not.toContain('internal note');
	});

	it('answers "not found" for someone else’s order', async () => {
		const svc = new OrdersService(
			...(Array.from({ length: 8 }, () => ({}) as never) as ConstructorParameters<typeof OrdersService>),
		);
		Object.assign(svc, {
			orders: { findByOrderNumber: async (number: string) => (number === 'ST-2611-482190' ? order : null) },
		});
		await expect(svc.shopView('cus_1', 'st-2611-482190')).resolves.toMatchObject({ orderNumber: 'ST-2611-482190' });
		await expect(svc.shopView('cus_2', 'ST-2611-482190')).rejects.toMatchObject({ status: 404 });
		await expect(svc.shopView('cus_1', 'ST-2611-482190')).resolves.toMatchObject({ orderNumber: 'ST-2611-482190' });
	});
});
