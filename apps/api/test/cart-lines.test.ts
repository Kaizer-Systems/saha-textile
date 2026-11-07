import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Cart, CartLine } from '@saha-textile/contracts';

import { CartLinesService } from '../src/cart/cart-lines.service';
import { CartController } from '../src/cart/cart.controller';
import { CartService } from '../src/cart/cart.service';
import { cookieNames } from '../src/common/cookies';
import { loadConfig } from '../src/config/app-config';

const config = loadConfig({
	JWT_ACCESS_SECRET: 'a'.repeat(32),
	JWT_REFRESH_SECRET: 'b'.repeat(32),
	CSRF_SECRET: 'c'.repeat(32),
});

const shopper = {
	userId: 'cus_1',
	sessionId: 's',
	audience: 'storefront',
	role: null,
	permissions: [],
} as never;
const staff = { userId: 'adm_1', sessionId: 's', audience: 'admin', role: 'staff', permissions: [] } as never;

const image = {
	assetId: 'a1',
	width: 300,
	height: 400,
	alt: 'Silk',
	dominantColor: null,
	thumbHash: null,
	roles: { gallery: [{ url: 'https://cdn.example.test/a.webp', width: 300, height: 400, format: 'image/webp' }] },
};

const page = (over: Record<string, unknown> = {}) => ({
	slug: 'silk',
	title: 'Silk',
	madeToOrder: false,
	selected: { sku: 'S1', sellingINR: 1000, mrpINR: 1200, quantity: 3, buyable: true },
	gallery: [image],
	optionGroups: [],
	variants: [],
	measurements: null,
	bundle: null,
	...over,
});

const stored = (over: Partial<CartLine> = {}): CartLine => ({
	id: 'line_1',
	productId: 'p1',
	variationId: null,
	quantity: 1,
	addons: [],
	...over,
});

const harness = () => {
	const carts = {
		findById: vi.fn(),
		findByUserId: vi.fn(async () => null as Cart | null),
		findByGuestToken: vi.fn(async () => null as Cart | null),
		save: vi.fn(async (cart: Cart) => cart),
		deleteById: vi.fn(),
	};
	const ownership = new CartService(carts as never, config);
	const catalog = {
		cartRead: vi.fn(async (): Promise<unknown> => ({ slug: 'silk', title: 'Silk', page: page() })),
	};
	return { carts, catalog, ownership, service: new CartLinesService(carts as never, ownership, catalog as never) };
};

const owned = (lines: CartLine[] = [stored()]): Cart => ({
	id: 'cart_1',
	userId: 'cus_1',
	guestToken: null,
	currency: 'INR',
	lines,
});

describe('CartLinesService', () => {
	let h: ReturnType<typeof harness>;

	beforeEach(() => {
		h = harness();
	});

	describe('reading', () => {
		it('answers an empty cart for a stranger, without storing one', async () => {
			expect(await h.service.current({})).toEqual({
				id: null,
				currency: 'INR',
				lines: [],
				subtotalINR: 0,
				count: 0,
			});
			expect(h.carts.findByGuestToken).not.toHaveBeenCalled();
			expect(h.carts.save).not.toHaveBeenCalled();
		});

		it('finds a guest by the hash of their cookie, never the raw value', async () => {
			await h.service.current({ guestToken: 'raw' });
			expect(h.carts.findByGuestToken).toHaveBeenCalledWith(h.ownership.hashGuestToken('raw'));
		});

		it('treats staff as a guest, so a shopper cart is never theirs', async () => {
			await h.service.current({ principal: staff, guestToken: 'raw' });
			expect(h.carts.findByUserId).not.toHaveBeenCalled();
		});

		it('prices each line from the live product and totals it', async () => {
			h.carts.findByUserId.mockResolvedValue(owned([stored({ quantity: 2 })]));
			const view = await h.service.current({ principal: shopper });
			expect(view).toMatchObject({ id: 'cart_1', subtotalINR: 2000, count: 2 });
			expect(view.lines[0]).toMatchObject({
				title: 'Silk',
				sku: 'S1',
				unitPriceINR: 1000,
				mrpINR: 1200,
				lineTotalINR: 2000,
				available: 3,
				problem: null,
				image: { assetId: 'a1' },
			});
		});

		it('shows the variant photo, and no photo when there is none', async () => {
			const variant = {
				id: 'v1',
				sku: 'V1',
				selections: {},
				sellingINR: 900,
				mrpINR: null,
				quantity: 2,
				buyable: true,
				galleryIndex: 1,
			};
			h.catalog.cartRead.mockResolvedValue({
				slug: 'silk',
				title: 'Silk',
				page: page({ variants: [variant], gallery: [image, { ...image, assetId: 'a2' }] }),
			});
			h.carts.findByUserId.mockResolvedValue(owned([stored({ variationId: 'v1' })]));
			expect((await h.service.current({ principal: shopper })).lines[0]?.image?.assetId).toBe('a2');
			h.catalog.cartRead.mockResolvedValue({ slug: 'silk', title: 'Silk', page: page({ gallery: [] }) });
			h.carts.findByUserId.mockResolvedValue(owned());
			expect((await h.service.current({ principal: shopper })).lines[0]?.image).toBeNull();
		});

		it('reports lines that cannot be bought, and leaves them out of the total', async () => {
			h.carts.findByUserId.mockResolvedValue(owned([stored({ quantity: 5 })]));
			const short = await h.service.current({ principal: shopper });
			expect(short.lines[0]?.problem).toBe('limited');
			expect(short.subtotalINR).toBe(5000);

			const gone = { sku: 'S1', sellingINR: 1000, mrpINR: null, quantity: 0, buyable: false };
			h.catalog.cartRead.mockResolvedValue({ slug: 'silk', title: 'Silk', page: page({ selected: gone }) });
			const sold = await h.service.current({ principal: shopper });
			expect(sold.lines[0]?.problem).toBe('out_of_stock');
			expect(sold.subtotalINR).toBe(0);

			h.catalog.cartRead.mockResolvedValue({ slug: 'silk', title: 'Silk', page: null });
			const retired = await h.service.current({ principal: shopper });
			expect(retired.lines[0]).toMatchObject({ problem: 'unavailable', title: 'Silk', lineTotalINR: 0 });
			expect(retired.count).toBe(5);

			h.catalog.cartRead.mockResolvedValue({ slug: 'silk', title: 'Silk', page: page({ selected: null }) });
			expect((await h.service.current({ principal: shopper })).lines[0]?.problem).toBe('unavailable');

			h.catalog.cartRead.mockResolvedValue(null);
			expect((await h.service.current({ principal: shopper })).lines[0]).toMatchObject({
				problem: 'unavailable',
				slug: '',
				title: '',
			});
		});

		it('has no limit for a made to order line', async () => {
			h.catalog.cartRead.mockResolvedValue({ slug: 'silk', title: 'Silk', page: page({ madeToOrder: true }) });
			h.carts.findByUserId.mockResolvedValue(owned([stored({ quantity: 50 })]));
			expect((await h.service.current({ principal: shopper })).lines[0]).toMatchObject({
				available: null,
				problem: null,
			});
		});
	});

	describe('adding', () => {
		const add = { productId: 'p1', quantity: 1 };

		it('starts a guest cart and hands back the raw cookie once', async () => {
			const { view, guestTokenRaw } = await h.service.add(add, {});
			expect(guestTokenRaw).toEqual(expect.any(String));
			const saved = h.carts.save.mock.calls[0]?.[0] as Cart;
			expect(saved.userId).toBeNull();
			expect(saved.guestToken).toBe(h.ownership.hashGuestToken(guestTokenRaw as string));
			expect(view.lines).toHaveLength(1);
			expect(view).not.toHaveProperty('guestToken');
		});

		it('starts an account cart for a shopper, from the session alone', async () => {
			const { guestTokenRaw } = await h.service.add(add, { principal: shopper });
			expect(guestTokenRaw).toBeNull();
			expect(h.carts.save.mock.calls[0]?.[0]).toMatchObject({ userId: 'cus_1', guestToken: null });
		});

		it('gives staff a guest cart, never one under their id', async () => {
			await h.service.add(add, { principal: staff });
			expect(h.carts.save.mock.calls[0]?.[0]).toMatchObject({ userId: null });
		});

		it('joins an equal line and keeps a different choice apart', async () => {
			h.carts.findByUserId.mockResolvedValue(owned());
			const joined = await h.service.add(add, { principal: shopper });
			expect(joined.view.lines).toHaveLength(1);
			expect(joined.view.lines[0]?.quantity).toBe(2);

			const groups = [
				{
					code: 'fall',
					label: 'Fall',
					role: 'named_add_on',
					displayStyle: 'rectangle',
					required: false,
					defaultTermCode: null,
					terms: [
						{ code: 'no', label: 'No', priceDeltaINR: null, requiresMeasurements: false },
						{ code: 'yes', label: 'Yes', priceDeltaINR: 90, requiresMeasurements: false },
					],
				},
			];
			h.catalog.cartRead.mockResolvedValue({ slug: 'silk', title: 'Silk', page: page({ optionGroups: groups }) });
			h.carts.findByUserId.mockResolvedValue(owned());
			const apart = await h.service.add(
				{ ...add, addons: [{ code: 'fall', value: 'yes' }] },
				{ principal: shopper },
			);
			expect(apart.view.lines.map((row) => row.unitPriceINR)).toEqual([1000, 1090]);
		});

		it('ignores anything but the choice: the price is always the server one', async () => {
			const sent = { ...add, unitPriceINR: 1, priceINR: 1 } as never;
			const { view } = await h.service.add(sent, {});
			expect(view.lines[0]?.unitPriceINR).toBe(1000);
		});

		it('refuses more than the stock, counting what the cart already holds', async () => {
			h.carts.findByUserId.mockResolvedValue(owned([stored({ quantity: 3 })]));
			const refused = await h.service.add(add, { principal: shopper }).catch((error: unknown) => error);
			expect(refused).toBeInstanceOf(ConflictException);
			expect((refused as ConflictException).getResponse()).toMatchObject({ issues: [{ code: 'stock_limit' }] });
			expect(h.carts.save).not.toHaveBeenCalled();
		});

		it('refuses a sold out product, a retired one and a false choice', async () => {
			const gone = { sku: 'S1', sellingINR: 1, mrpINR: null, quantity: 5, buyable: false };
			h.catalog.cartRead.mockResolvedValueOnce({ slug: 's', title: 'S', page: page({ selected: gone }) });
			await expect(h.service.add(add, {})).rejects.toBeInstanceOf(ConflictException);

			h.catalog.cartRead.mockResolvedValueOnce({ slug: 's', title: 'S', page: null });
			await expect(h.service.add(add, {})).rejects.toBeInstanceOf(NotFoundException);
			h.catalog.cartRead.mockResolvedValueOnce(null);
			await expect(h.service.add(add, {})).rejects.toBeInstanceOf(NotFoundException);

			const falseChoice = { ...add, addons: [{ code: 'free_gift', value: 'yes' }] };
			const refused = await h.service.add(falseChoice, {}).catch((error: unknown) => error);
			expect(refused).toBeInstanceOf(BadRequestException);
			expect((refused as BadRequestException).getResponse()).toMatchObject({ issues: [{ code: 'unknown_option' }] });
		});

		it('treats a default left alone and the same choice made by hand as one line', async () => {
			const groups = [
				{
					code: 'fall',
					label: 'Fall',
					role: 'named_add_on',
					displayStyle: 'rectangle',
					required: false,
					defaultTermCode: 'no',
					terms: [{ code: 'no', label: 'No', priceDeltaINR: null, requiresMeasurements: false }],
				},
			];
			h.catalog.cartRead.mockResolvedValue({ slug: 'silk', title: 'Silk', page: page({ optionGroups: groups }) });
			h.carts.findByUserId.mockResolvedValue(owned([stored({ addons: [{ code: 'fall', value: 'no' }] })]));
			const { view } = await h.service.add(add, { principal: shopper });
			expect(view.lines).toHaveLength(1);
			expect(view.lines[0]?.quantity).toBe(2);
		});

		it('keeps measurements with the line', async () => {
			const groups = [
				{
					code: 'stitch',
					label: 'Stitch',
					role: 'named_add_on',
					displayStyle: 'rectangle',
					required: false,
					defaultTermCode: null,
					terms: [{ code: 'yes', label: 'Yes', priceDeltaINR: 500, requiresMeasurements: true }],
				},
			];
			const measurements = {
				templateCode: null,
				priceINR: 0,
				fields: [{ code: 'bust', label: 'Bust', unit: 'in', min: null, max: null, step: null }],
			};
			h.catalog.cartRead.mockResolvedValue({
				slug: 'silk',
				title: 'Silk',
				page: page({ optionGroups: groups, measurements }),
			});
			const { view } = await h.service.add({ ...add, addons: [{ code: 'bust', value: 34 }] }, {});
			expect(view.lines[0]?.addons).toEqual([
				{ code: 'stitch', value: 'yes' },
				{ code: 'bust', value: 34 },
			]);
		});

		it('has no ceiling for made to order', async () => {
			h.catalog.cartRead.mockResolvedValue({ slug: 'silk', title: 'Silk', page: page({ madeToOrder: true }) });
			const { view } = await h.service.add({ ...add, quantity: 40 }, {});
			expect(view.lines[0]?.quantity).toBe(40);
		});
	});

	describe('changing', () => {
		const signedIn = { principal: shopper };

		it('sets the quantity and keeps the choices', async () => {
			h.carts.findByUserId.mockResolvedValue(owned([stored({ addons: [] })]));
			const view = await h.service.update('line_1', { quantity: 3 }, signedIn);
			expect(view.lines[0]?.quantity).toBe(3);
		});

		it('refuses more than the stock', async () => {
			h.carts.findByUserId.mockResolvedValue(owned());
			await expect(h.service.update('line_1', { quantity: 4 }, signedIn)).rejects.toBeInstanceOf(ConflictException);
		});

		it('hides a line that is not in this shopper cart', async () => {
			await expect(h.service.update('line_1', { quantity: 1 }, {})).rejects.toBeInstanceOf(NotFoundException);
			h.carts.findByUserId.mockResolvedValue(owned());
			await expect(h.service.update('other', { quantity: 1 }, signedIn)).rejects.toBeInstanceOf(NotFoundException);
			await expect(h.service.remove('other', signedIn)).rejects.toBeInstanceOf(NotFoundException);
			await expect(h.service.remove('line_1', {})).rejects.toBeInstanceOf(NotFoundException);
		});

		it('moves a line to new choices, and folds it into its twin', async () => {
			const variant = (id: string) => ({
				id,
				sku: id,
				selections: {},
				sellingINR: 700,
				mrpINR: null,
				quantity: 9,
				buyable: true,
				galleryIndex: null,
			});
			h.catalog.cartRead.mockResolvedValue({
				slug: 'silk',
				title: 'Silk',
				page: page({ variants: [variant('v1'), variant('v2')] }),
			});
			const lines = [
				stored({ id: 'a', variationId: 'v1', quantity: 2 }),
				stored({ id: 'b', variationId: 'v2', quantity: 3 }),
			];
			h.carts.findByUserId.mockResolvedValue(owned(lines));
			const folded = await h.service.update('a', { quantity: 2, variationId: 'v2', addons: [] }, signedIn);
			expect(folded.lines).toHaveLength(1);
			expect(folded.lines[0]).toMatchObject({ id: 'a', variationId: 'v2', quantity: 5 });

			h.carts.findByUserId.mockResolvedValue(owned([stored({ id: 'a', variationId: 'v1' }), stored({ id: 'c', variationId: 'v2' })]));
			const kept = await h.service.update('a', { quantity: 1 }, signedIn);
			expect(kept.lines).toHaveLength(2);
		});

		it('removes a line', async () => {
			h.carts.findByUserId.mockResolvedValue(owned());
			expect((await h.service.remove('line_1', signedIn)).lines).toEqual([]);
		});
	});
});

describe('CartController', () => {
	const view = { id: 'c1' };
	const harnessed = () => {
		const lines = {
			current: vi.fn(async () => view),
			add: vi.fn(async () => ({ view, guestTokenRaw: null as string | null })),
			update: vi.fn(async () => view),
			remove: vi.fn(async () => view),
		};
		const carts = { getCart: vi.fn(async () => ({ id: 'c1', guestToken: 'secret' })) };
		const limits = { enforce: vi.fn(async () => {}) };
		const controller = new CartController(carts as never, lines as never, limits as never, config);
		return { controller, lines, carts, limits, reply: { setCookie: vi.fn() } };
	};
	const cookie = cookieNames(config).guest;
	const guest = { cookies: { [cookie]: 'g' }, ip: '1.1.1.1' } as never;
	const stranger = { ip: '1.1.1.1' } as never;

	it('reads with the session and the cookie', async () => {
		const { controller, lines } = harnessed();
		await controller.current(guest, undefined);
		expect(lines.current).toHaveBeenCalledWith({ principal: undefined, guestToken: 'g' });
		await controller.current(stranger, shopper);
		expect(lines.current).toHaveBeenLastCalledWith({ principal: shopper, guestToken: null });
	});

	it('issues the cookie for a new guest and renews it on each change', async () => {
		const { controller, lines, limits, reply } = harnessed();
		lines.add.mockResolvedValueOnce({ view, guestTokenRaw: 'raw' });
		await controller.addLine({} as never, stranger, undefined, reply as never);
		expect(reply.setCookie.mock.calls[0]?.slice(0, 2)).toEqual([cookie, 'raw']);
		await controller.addLine({} as never, guest, undefined, reply as never);
		await controller.updateLine('l1', { quantity: 2 } as never, guest, undefined, reply as never);
		await controller.removeLine('l1', guest, undefined, reply as never);
		expect(reply.setCookie).toHaveBeenCalledTimes(4);
		expect(limits.enforce).toHaveBeenCalledTimes(4);
		expect(limits.enforce).toHaveBeenCalledWith('cart_write', { ip: '1.1.1.1' });
	});

	it('sets no cookie for an account cart', async () => {
		const { controller, reply } = harnessed();
		await controller.addLine({} as never, stranger, shopper, reply as never);
		await controller.updateLine('l1', { quantity: 2 } as never, stranger, shopper, reply as never);
		await controller.removeLine('l1', stranger, shopper, reply as never);
		expect(reply.setCookie).not.toHaveBeenCalled();
	});

	it('keeps the support read, hiding the guest hash', async () => {
		const { controller, carts } = harnessed();
		expect((await controller.get('c1', guest, undefined)).guestToken).toBeNull();
		expect(carts.getCart).toHaveBeenCalledWith('c1', {
			principal: undefined,
			guestToken: 'g',
			allowReadPermissions: ['cart.index'],
		});
	});
});
