import { Order } from '@saha-textile/contracts';
import { describe, expect, it, vi } from 'vitest';

import { childLines, parcelUnits } from '../src/orders/order-tree';
import { OrdersController } from '../src/orders/orders.controller';
import { OrdersService } from '../src/orders/orders.service';
import { shopOrderView } from '../src/orders/shop-order-view';

const child = (over: Record<string, unknown> = {}) =>
	({
		role: 'piece',
		key: 'k',
		parentKey: null,
		level: null,
		productId: 'p',
		title: 'Piece',
		sku: 'SKU',
		image: null,
		variantId: null,
		variantLabel: null,
		quantity: 1,
		priceINR: 100,
		mrpINR: null,
		...over,
	}) as never;

const line = (over: Record<string, unknown> = {}) => ({
	productId: 'p1',
	title: { en: 'Red Saree' },
	sku: 'SAR-1',
	quantity: 1,
	unitPriceINR: 1000,
	unitPricePaid: 1000,
	lineTotalINR: 1000,
	lineTotalPaid: 1000,
	...over,
});

const order = (lines: unknown[], over: Record<string, unknown> = {}) =>
	Order.parse({
		id: 'ord_1',
		orderNumber: 'ST-1',
		userId: 'cus_1',
		currency: 'INR',
		lines,
		subtotalINR: 0,
		subtotalPaid: 0,
		totalINR: 1000,
		totalPaid: 1000,
		statusTimeline: [{ status: 'placed', at: '2026-11-20T00:00:00.000Z' }],
		...over,
	});

describe('the order tree: the last cases', () => {
	it('sends one length of a metre line, however many metres were bought', () => {
		const units = parcelUnits([
			{
				id: 'm',
				productId: 'silk',
				variationId: null,
				quantity: 7.5,
				soldBy: 'metre',
				unitPriceINR: 400,
				mrpINR: null,
				children: [child({ productId: 'lining', quantity: 2 })],
			},
		]);
		expect(units).toEqual([
			{ cartIndex: 0, productId: 'silk', variationId: null, quantity: 1 },
			{ cartIndex: 0, productId: 'lining', variationId: null, quantity: 2 },
		]);
	});

	it('names a child without a SKU by its product, and hangs it from no line when the parent has no id yet', () => {
		const rows = childLines(
			{
				id: 'c1',
				productId: 'saree',
				variationId: null,
				quantity: 2,
				unitPriceINR: 1000,
				mrpINR: null,
				children: [child({ role: 'free', key: 'bag', sku: '', productId: 'bag', priceINR: 0 })],
			},
			{ productId: 'saree' } as never,
			(amount) => amount,
			0,
			'2026-11-24T00:00:00.000Z',
		);
		expect(rows).toEqual([
			expect.objectContaining({
				lineId: 'c1~bag',
				sku: 'bag',
				quantity: 2,
				unitPriceINR: 0,
				lineTotalINR: 0,
				couponINR: 0,
				parentLineId: null,
			}),
		]);
	});
});

describe('an order as its shopper sees it: lines saved before every field existed', () => {
	it('lists no details for a line saved without attributes or add-ons', () => {
		const saved = order([line({ lineId: 'l1' })]);
		const bare = { ...saved, lines: saved.lines.map(({ attributes: _a, addons: _b, ...rest }) => rest) };
		expect(shopOrderView(bare as never).lines[0]?.details).toEqual([]);
	});

	it('shows no saving on a set whose pieces were not priced separately', () => {
		const view = shopOrderView(
			order([
				line({ lineId: 's', role: 'bundle', set: { heading: 'choose', priceINR: 1000, separatelyINR: null } }),
				line({ lineId: 's~a', role: 'piece', parentLineId: 's' }),
			]),
		);
		expect(view.lines[0]?.set).toEqual({ heading: 'choose', saved: null });
	});
});

describe('the shopper’s own orders over the shop’s routes', () => {
	const shopper = { userId: 'cus_1', audience: 'storefront' } as never;

	it('lists a page of the shopper’s orders, 10 to a page by default and never more than 50', async () => {
		const orders = { shopList: vi.fn(async () => ({ items: [] })), shopView: vi.fn(async () => ({})) };
		const controller = new OrdersController(orders as never, {} as never, {} as never);
		await controller.mine(shopper);
		await controller.mine(shopper, '3', '200');
		await controller.mine(shopper, 'x', '0');
		expect(orders.shopList.mock.calls).toEqual([
			['cus_1', { page: 1, pageSize: 10 }],
			['cus_1', { page: 3, pageSize: 50 }],
			['cus_1', { page: 1, pageSize: 10 }],
		]);
		await controller.mineOne('st-1', shopper);
		expect(orders.shopView).toHaveBeenCalledWith('cus_1', 'st-1');
	});

	it('turns a page of saved orders into the shop’s list rows', async () => {
		const svc = new OrdersService(
			...(Array.from({ length: 6 }, () => ({}) as never) as unknown as ConstructorParameters<
				typeof OrdersService
			>),
		);
		const saved = order([line({ lineId: 'l1', imageUrl: 'saree.jpg' })]);
		Object.assign(svc, {
			orders: { listByUser: async () => ({ items: [saved], total: 1, page: 2, pageSize: 5 }) },
		});
		const page = await svc.shopList('cus_1', { page: 2, pageSize: 5 });
		expect(page).toMatchObject({ total: 1, page: 2, pageSize: 5 });
		expect(page.items[0]).toMatchObject({
			orderNumber: 'ST-1',
			firstTitle: 'Red Saree',
			firstImageUrl: 'saree.jpg',
		});
	});
});
