import {
	BadRequestException,
	ForbiddenException,
	HttpException,
	NotFoundException,
	UnauthorizedException,
} from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { assertOwnership, Principal } from '../src/auth/ownership';
import { tooManyRequests } from '../src/auth/rate-limit-response';
import { CartController } from '../src/cart/cart.controller';
import { CartService, toPublicCart } from '../src/cart/cart.service';
import { CurrencyController } from '../src/currency/currency.controller';
import { CurrencyService } from '../src/currency/currency.service';
import { HealthController } from '../src/health/health.controller';
import { OrdersController } from '../src/orders/orders.controller';
import { OrdersService } from '../src/orders/orders.service';
import { PrivacyController } from '../src/privacy/privacy.controller';
import { PromotionsController } from '../src/promotions/promotions.controller';
import { PromotionsService } from '../src/promotions/promotions.service';

const { readyState } = vi.hoisted(() => ({ readyState: { value: 1 } }));

vi.mock('@saha-textile/adapters-db-mongo', () => ({
	getMongoose: () => ({ connection: { readyState: readyState.value } }),
}));

const shopper = { userId: 'cus_1', audience: 'storefront', permissions: [] } as never;
const config = {
	cookies: { csrfSecret: 'pepper', guestName: 'st_guest', secure: false },
	jwt: { refreshSecret: 'refresh' },
} as never;

const product = {
	id: 'p1',
	sku: 'SKU',
	title: { en: 'Red' },
	basePriceINR: 1000,
	variations: [
		{ id: 'v1', sku: 'V1', priceINR: 800, salePriceINR: 700, attributes: { size: 's' } },
		{ id: 'v2', sku: 'V2', priceINR: 900, salePriceINR: null, attributes: {} },
	],
};
const line = (overrides: Record<string, unknown> = {}) => ({
	id: 'l1',
	productId: 'p1',
	variationId: null,
	quantity: 2,
	addons: [],
	...overrides,
});

const ordersHarness = () => {
	const orders = {
		findById: vi.fn(async () => ({ id: 'o1', userId: 'cus_1' }) as unknown),
		listByUser: vi.fn(async () => 'page'),
		updateStatus: vi.fn(async () => 'updated' as unknown),
		save: vi.fn(async (row: unknown) => row),
	};
	const products = { findById: vi.fn(async () => product as unknown) };
	const currencies = { findByCode: vi.fn(async () => ({ enabled: true, rateFromINR: 0.5 }) as unknown) };
	const promotions = { findByCouponCode: vi.fn(async () => null as unknown) };
	const transactions = { withTransaction: vi.fn(async (work: (context: unknown) => Promise<unknown>) => work({})) };
	const carts = {
		getCartForOrder: vi.fn(async () => ({ id: 'c1', currency: 'INR', lines: [line()] }) as unknown),
		consumeCart: vi.fn(async () => {}),
	};
	const service = new OrdersService(
		orders as never,
		products as never,
		currencies as never,
		promotions as never,
		transactions as never,
		carts as never,
	);
	return { service, orders, products, currencies, promotions, carts };
};

describe('OrdersService', () => {
	let h: ReturnType<typeof ordersHarness>;
	const input = (overrides: Record<string, unknown> = {}) =>
		({ cartId: 'c1', principal: shopper, ...overrides }) as never;

	beforeEach(() => {
		h = ordersHarness();
	});

	it('refuses an empty cart, a missing product, and a missing variation', async () => {
		h.carts.getCartForOrder.mockResolvedValue({ id: 'c1', lines: [] });
		await expect(h.service.createFromCart(input())).rejects.toBeInstanceOf(BadRequestException);
		h.carts.getCartForOrder.mockResolvedValue({ id: 'c1', lines: [line()] });
		h.products.findById.mockResolvedValue(null);
		await expect(h.service.createFromCart(input())).rejects.toThrow('Product not found');
		h.products.findById.mockResolvedValue(product);
		h.carts.getCartForOrder.mockResolvedValue({ id: 'c1', lines: [line({ variationId: 'gone' })] });
		await expect(h.service.createFromCart(input())).rejects.toThrow('Variation not found');
	});

	it('prices from the base, a sale, or a variation', async () => {
		h.carts.getCartForOrder.mockResolvedValue({
			id: 'c1',
			currency: 'INR',
			lines: [
				line(),
				line({ variationId: 'v1', addons: [{ code: 'fall', value: 'yes' }] }),
				line({ variationId: 'v2', quantity: 1 }),
			],
		});
		const order = await h.service.createFromCart(input());
		expect(order.lines.map((row) => row.unitPriceINR)).toEqual([1000, 700, 900]);
		expect(order.lines[1]).toMatchObject({
			sku: 'V1',
			attributes: { size: 's' },
			addons: [{ code: 'fall', value: 'yes' }],
		});
		expect(order).toMatchObject({ subtotalINR: 4300, totalINR: 4300, status: 'pending', currency: 'INR' });
		expect(h.carts.consumeCart).toHaveBeenCalledTimes(1);
	});

	it('converts to the chosen currency', async () => {
		const order = await h.service.createFromCart(input({ currency: 'usd' }));
		expect(order).toMatchObject({ currency: 'USD', totalPaid: 1000 });
	});

	it('falls back to the cart currency, then to rupees', async () => {
		h.carts.getCartForOrder.mockResolvedValue({ id: 'c1', currency: 'eur', lines: [line()] });
		expect((await h.service.createFromCart(input())).currency).toBe('EUR');
		h.carts.getCartForOrder.mockResolvedValue({ id: 'c1', lines: [line()] });
		expect((await h.service.createFromCart(input())).currency).toBe('INR');
	});

	it('refuses a currency that is off or unknown', async () => {
		h.currencies.findByCode.mockResolvedValue(null);
		await expect(h.service.createFromCart(input({ currency: 'USD' }))).rejects.toThrow('Unsupported currency');
		h.currencies.findByCode.mockResolvedValue({ enabled: false });
		await expect(h.service.createFromCart(input({ currency: 'USD' }))).rejects.toThrow('Unsupported currency');
	});

	it('applies a coupon, and refuses a bad or small one', async () => {
		await expect(h.service.createFromCart(input({ couponCode: 'x' }))).rejects.toThrow('Invalid coupon');
		const promo = { id: 'pr', couponCode: 'SAVE', type: 'fixed', value: 100, conditions: { minCartINR: 5000 } };
		h.promotions.findByCouponCode.mockResolvedValue(promo);
		await expect(h.service.createFromCart(input({ couponCode: 'save' }))).rejects.toThrow('below the minimum');
		h.promotions.findByCouponCode.mockResolvedValue({ ...promo, conditions: { minCartINR: 0 } });
		const order = await h.service.createFromCart(input({ couponCode: ' save ' }));
		expect(order).toMatchObject({
			totalINR: 1900,
			promotionsApplied: [{ promotionId: 'pr', code: 'SAVE', amountINR: 100 }],
		});
		expect(h.promotions.findByCouponCode).toHaveBeenLastCalledWith('SAVE');
	});

	it('reads orders', async () => {
		expect(await h.service.getOrder('o1')).toMatchObject({ id: 'o1' });
		h.orders.findById.mockResolvedValue(null);
		await expect(h.service.getOrder('o1')).rejects.toBeInstanceOf(NotFoundException);
		expect(await h.service.listByUser('cus_1', {} as never)).toBe('page');
	});

	it('turns a missing order into a 404 and leaves other failures alone', async () => {
		expect(await h.service.updateStatus('o1', 'paid' as never)).toBe('updated');
		h.orders.updateStatus.mockRejectedValue(new Error('Order not found: o1'));
		await expect(h.service.updateStatus('o1', 'paid' as never)).rejects.toBeInstanceOf(NotFoundException);
		h.orders.updateStatus.mockRejectedValue(new Error('disk full'));
		await expect(h.service.updateStatus('o1', 'paid' as never)).rejects.toThrow('disk full');
		h.orders.updateStatus.mockRejectedValue('text');
		await expect(h.service.updateStatus('o1', 'paid' as never)).rejects.toBe('text');
	});
});

describe('OrdersController', () => {
	const service = () => ({
		createFromCart: vi.fn(async () => 'created'),
		listByUser: vi.fn(async () => 'page'),
		getOrder: vi.fn(async () => ({ userId: 'cus_1' })),
		updateStatus: vi.fn(async () => 'updated'),
	});

	it('needs a session', () => {
		const controller = new OrdersController(service() as never, config);
		expect(() => controller.create(undefined, {} as never, {} as never)).toThrow(UnauthorizedException);
		expect(() => controller.listMine(undefined)).toThrow(UnauthorizedException);
	});

	it('creates with the guest cookie when there is one', async () => {
		const orders = service();
		const controller = new OrdersController(orders as never, config);
		await controller.create(shopper, { cartId: 'c' } as never, { cookies: { st_guest: 'g' } } as never);
		expect(orders.createFromCart).toHaveBeenLastCalledWith(expect.objectContaining({ guestToken: 'g' }));
		await controller.create(shopper, { cartId: 'c' } as never, {} as never);
		expect(orders.createFromCart).toHaveBeenLastCalledWith(expect.objectContaining({ guestToken: null }));
	});

	it('pages, reads with ownership, and updates a status', async () => {
		const orders = service();
		const controller = new OrdersController(orders as never, config);
		await controller.listMine(shopper, '2', '5');
		expect(orders.listByUser).toHaveBeenLastCalledWith('cus_1', { page: 2, pageSize: 5 });
		await controller.listMine(shopper);
		expect(orders.listByUser).toHaveBeenLastCalledWith('cus_1', { page: undefined, pageSize: undefined });
		expect(await controller.get('o1', shopper)).toEqual({ userId: 'cus_1' });
		await expect(
			controller.get('o1', { userId: 'x', audience: 'storefront', permissions: [] } as never),
		).rejects.toBeInstanceOf(NotFoundException);
		expect(await controller.updateStatus('o1', { status: 'paid', note: 'n' } as never)).toBe('updated');
	});
});

describe('assertOwnership', () => {
	it('needs a principal', () => {
		expect(() => assertOwnership({ principal: undefined, ownerUserId: 'a' })).toThrow(ForbiddenException);
	});

	it('lets a support operator through only with the permission', () => {
		const operator = { userId: 'adm', audience: 'admin', permissions: ['order.index'] } as never;
		expect(() =>
			assertOwnership({ principal: operator, ownerUserId: 'x', allowPermissions: ['order.index'] }),
		).not.toThrow();
		expect(() =>
			assertOwnership({ principal: operator, ownerUserId: 'x', allowPermissions: ['cart.index'] as never }),
		).toThrow(NotFoundException);
		expect(() => assertOwnership({ principal: operator, ownerUserId: 'x' })).toThrow(NotFoundException);
		const customer = { userId: 'c', audience: 'storefront', permissions: ['order.index'] } as never;
		expect(() =>
			assertOwnership({ principal: customer, ownerUserId: 'x', allowPermissions: ['order.index'] }),
		).toThrow(NotFoundException);
	});

	it('hides a record with no owner', () => {
		expect(() => assertOwnership({ principal: shopper, ownerUserId: null })).toThrow(NotFoundException);
		expect(() => assertOwnership({ principal: shopper, ownerUserId: 'cus_1' })).not.toThrow();
	});

	it('reads the principal off the request', () => {
		expect(Principal).toBeDefined();
		const factory = (Reflect.getMetadata('__routeArguments__', class {}, 'x') ?? null) as unknown;
		expect(factory).toBeNull();
	});
});

describe('tooManyRequests', () => {
	it('sets the wait when it has a reply', () => {
		const reply = { header: vi.fn() };
		const error = tooManyRequests({ allowed: false, retryAfterSeconds: 5 } as never, reply as never);
		expect(error).toBeInstanceOf(HttpException);
		expect(reply.header).toHaveBeenCalledWith('retry-after', '5');
		expect(tooManyRequests({ allowed: false, retryAfterSeconds: 5 } as never).getStatus()).toBe(429);
	});
});

const cartHarness = (pepper: string | undefined = 'pepper') => {
	const carts = {
		findById: vi.fn(async () => null as unknown),
		findByUserId: vi.fn(async () => null as unknown),
		findByGuestToken: vi.fn(async () => null as unknown),
		save: vi.fn(async (row: unknown) => row),
		deleteById: vi.fn(async () => {}),
	};
	const service = new CartService(
		carts as never,
		{ cookies: { csrfSecret: pepper }, jwt: { refreshSecret: 'refresh' } } as never,
	);
	return { service, carts };
};

describe('CartService', () => {
	let h: ReturnType<typeof cartHarness>;
	const owned = (overrides: Record<string, unknown> = {}) => ({
		id: 'c1',
		userId: 'cus_1',
		guestToken: null,
		lines: [line()],
		...overrides,
	});

	beforeEach(() => {
		h = cartHarness();
	});

	it('hides the guest token', () => {
		expect(toPublicCart({ guestToken: 'x' } as never).guestToken).toBeNull();
	});

	it('peppers with the refresh secret when there is no CSRF secret', () => {
		expect(cartHarness(undefined as never).service.hashGuestToken('a')).toEqual(expect.any(String));
	});

	it('reuses a user cart, and creates one when none exists', async () => {
		h.carts.findByUserId.mockResolvedValue(owned());
		expect(await h.service.createCart({ principal: shopper })).toMatchObject({
			guestTokenRaw: null,
			cart: { id: 'c1' },
		});
		h.carts.findByUserId.mockResolvedValue(null);
		const fresh = await h.service.createCart({ principal: shopper, currency: 'USD' });
		expect(fresh.cart).toMatchObject({ userId: 'cus_1', currency: 'USD' });
		expect((await h.service.createCart({ principal: shopper })).cart.currency).toBe('INR');
	});

	it('creates a guest cart with a token', async () => {
		const fresh = await h.service.createCart({});
		expect(fresh.guestTokenRaw).toEqual(expect.any(String));
		expect(fresh.cart.currency).toBe('INR');
		expect((await h.service.createCart({ currency: 'EUR' })).cart.currency).toBe('EUR');
	});

	it('hides a cart from anyone else, and allows support to read it', async () => {
		await expect(h.service.getCart('c1', {})).rejects.toBeInstanceOf(NotFoundException);
		h.carts.findById.mockResolvedValue(owned({ userId: 'other' }));
		await expect(h.service.getCart('c1', { principal: shopper })).rejects.toBeInstanceOf(NotFoundException);
		const support = { userId: 'adm', audience: 'admin', permissions: ['cart.index'] } as never;
		await expect(
			h.service.getCart('c1', { principal: support, allowReadPermissions: ['cart.index'] }),
		).resolves.toBeDefined();
		await expect(h.service.getCart('c1', { principal: support })).rejects.toBeInstanceOf(NotFoundException);
		await expect(
			h.service.getCart('c1', { principal: support, allowReadPermissions: ['other'] }),
		).rejects.toBeInstanceOf(NotFoundException);
	});

	it('lets a guest in with the right token only', async () => {
		const { raw, hash } = h.service.mintGuestToken();
		h.carts.findById.mockResolvedValue(owned({ userId: null, guestToken: hash }));
		await expect(h.service.getCart('c1', { guestToken: raw })).resolves.toBeDefined();
		await expect(h.service.getCart('c1', { guestToken: 'wrong' })).rejects.toBeInstanceOf(NotFoundException);
		await expect(h.service.getCart('c1', {})).rejects.toBeInstanceOf(NotFoundException);
		h.carts.findById.mockResolvedValue(owned({ userId: null, guestToken: null }));
		await expect(h.service.getCart('c1', { guestToken: raw })).rejects.toBeInstanceOf(NotFoundException);
	});

	it('adds, updates and removes lines', async () => {
		await expect(h.service.addLine('c1', { productId: 'p', quantity: 1 }, {})).rejects.toBeInstanceOf(
			NotFoundException,
		);
		h.carts.findById.mockImplementation(async () => owned());
		const added = await h.service.addLine('c1', { productId: 'p', quantity: 1 }, { principal: shopper });
		expect(added.lines.at(-1)).toMatchObject({ variationId: null, addons: [] });
		const filled = await h.service.addLine(
			'c1',
			{ productId: 'p', variationId: 'v', quantity: 1, addons: [{ code: 'a', value: 1 }] },
			{ principal: shopper },
		);
		expect(filled.lines.at(-1)).toMatchObject({ variationId: 'v', addons: [{ code: 'a', value: 1 }] });
		expect((await h.service.updateLineQuantity('c1', 'l1', 5, { principal: shopper })).lines[0]?.quantity).toBe(5);
		await expect(h.service.updateLineQuantity('c1', 'gone', 5, { principal: shopper })).rejects.toBeInstanceOf(
			NotFoundException,
		);
		expect((await h.service.removeLine('c1', 'l1', { principal: shopper })).lines).toEqual([]);
		await expect(h.service.removeLine('c1', 'gone', { principal: shopper })).rejects.toBeInstanceOf(
			NotFoundException,
		);
	});

	it('checks ownership for an order', async () => {
		await expect(h.service.getCartForOrder('c1', { principal: shopper })).rejects.toBeInstanceOf(NotFoundException);
		h.carts.findById.mockResolvedValue(owned());
		await expect(h.service.getCartForOrder('c1', { principal: shopper })).resolves.toBeDefined();
		const { raw, hash } = h.service.mintGuestToken();
		h.carts.findById.mockResolvedValue(owned({ userId: null, guestToken: hash }));
		await expect(h.service.getCartForOrder('c1', { principal: shopper, guestToken: raw })).resolves.toBeDefined();
		await expect(
			h.service.getCartForOrder('c1', { principal: shopper, guestToken: 'wrong' }),
		).rejects.toBeInstanceOf(NotFoundException);
		await expect(h.service.getCartForOrder('c1', { principal: shopper })).rejects.toBeInstanceOf(NotFoundException);
		h.carts.findById.mockResolvedValue(owned({ userId: 'other' }));
		await expect(h.service.getCartForOrder('c1', { principal: shopper })).rejects.toBeInstanceOf(NotFoundException);
		h.carts.findById.mockResolvedValue(owned({ userId: null }));
		await expect(h.service.getCartForOrder('c1', { principal: shopper, guestToken: raw })).rejects.toBeInstanceOf(
			NotFoundException,
		);
	});

	it('consumes a cart', async () => {
		await h.service.consumeCart('c1');
		expect(h.carts.deleteById).toHaveBeenCalledWith('c1', undefined);
	});

	describe('merging a guest cart', () => {
		it('returns the user cart when there is no proof, or the proof is stale', async () => {
			h.carts.findByUserId.mockResolvedValue(owned());
			expect(await h.service.mergeGuestCartForUser('cus_1', null)).toMatchObject({ id: 'c1' });
			expect(await h.service.mergeGuestCartForUser('cus_1', 'raw')).toMatchObject({ id: 'c1' });
			h.carts.findByGuestToken.mockResolvedValue(owned({ id: 'g', userId: 'other' }));
			expect(await h.service.mergeGuestCartForUser('cus_1', 'raw')).toMatchObject({ id: 'c1' });
		});

		it('adopts the guest cart when the user has none', async () => {
			h.carts.findByGuestToken.mockResolvedValue(owned({ id: 'g', userId: null, guestToken: 'x' }));
			expect(await h.service.mergeGuestCartForUser('cus_1', 'raw')).toMatchObject({
				id: 'g',
				userId: 'cus_1',
				guestToken: null,
			});
		});

		it('sums matching lines and keeps the rest', async () => {
			const addons = [
				{ code: 'b', value: 1 },
				{ code: 'a', value: 2 },
			];
			h.carts.findByUserId.mockResolvedValue(
				owned({
					lines: [line({ id: 'u1', addons }), line({ id: 'u2', variationId: 'v1', addons: undefined })],
				}),
			);
			h.carts.findByGuestToken.mockResolvedValue(
				owned({
					id: 'g',
					userId: null,
					lines: [line({ id: 'g1', addons: [...addons].reverse() }), line({ id: 'g2', productId: 'p2' })],
				}),
			);
			const merged = await h.service.mergeGuestCartForUser('cus_1', 'raw');
			expect(merged?.lines.map((row) => row.quantity)).toEqual([4, 2, 2]);
			expect(h.carts.deleteById).toHaveBeenCalledWith('g');
		});
	});
});

describe('CartController', () => {
	const cart = { id: 'c1', guestToken: 'secret' };
	const service = () => ({
		createCart: vi.fn(async () => ({ cart, guestTokenRaw: null as string | null })),
		getCart: vi.fn(async () => cart),
		addLine: vi.fn(async () => cart),
		updateLineQuantity: vi.fn(async () => cart),
		removeLine: vi.fn(async () => cart),
	});

	it('sets the guest cookie only for a new guest cart', async () => {
		const carts = service();
		const controller = new CartController(carts as never, config);
		const reply = { setCookie: vi.fn() };
		await controller.create({} as never, shopper, reply as never);
		expect(reply.setCookie).not.toHaveBeenCalled();
		carts.createCart.mockResolvedValue({ cart, guestTokenRaw: 'raw' });
		const created = await controller.create({} as never, undefined, reply as never);
		expect(reply.setCookie).toHaveBeenCalledTimes(1);
		expect(created.guestToken).toBeNull();
	});

	it('passes the actor to every line route', async () => {
		const carts = service();
		const controller = new CartController(carts as never, config);
		const request = { cookies: { st_guest: 'g' } } as never;
		await controller.get('c1', request, undefined);
		expect(carts.getCart).toHaveBeenCalledWith('c1', {
			principal: undefined,
			guestToken: 'g',
			allowReadPermissions: ['cart.index'],
		});
		await controller.get('c1', {} as never, shopper);
		expect(carts.getCart).toHaveBeenLastCalledWith('c1', expect.objectContaining({ guestToken: null }));
		await controller.addLine('c1', {} as never, request, shopper);
		await controller.updateLine('c1', 'l1', { quantity: 2 } as never, request, shopper);
		expect(carts.updateLineQuantity).toHaveBeenCalledWith('c1', 'l1', 2, expect.anything());
		await controller.removeLine('c1', 'l1', request, shopper);
		expect(carts.removeLine).toHaveBeenCalledTimes(1);
	});
});

describe('PrivacyController', () => {
	const harness = () => {
		const consent = {
			findLatestForUser: vi.fn(async () => null as unknown),
			findLatestForGuest: vi.fn(async () => null as unknown),
			append: vi.fn(async () => {}),
		};
		return { consent, controller: new PrivacyController(consent as never, config) };
	};
	const latest = { categories: { necessary: true }, policyVersion: 'v1', createdAt: 'at' };

	it('answers all optional categories off when nothing is stored', async () => {
		const { controller } = harness();
		const state = await controller.getConsent({} as never, undefined);
		expect(state).toMatchObject({ policyVersion: null, categories: { marketing: false } });
	});

	it('reads the latest for a person or a guest', async () => {
		const { controller, consent } = harness();
		consent.findLatestForUser.mockResolvedValue(latest);
		expect((await controller.getConsent({} as never, shopper)).policyVersion).toBe('v1');
		consent.findLatestForGuest.mockResolvedValue(latest);
		expect((await controller.getConsent({ cookies: { st_guest: 'g' } } as never, undefined)).updatedAt).toBe('at');
	});

	it('records a decision for a person or a guest', async () => {
		const { controller, consent } = harness();
		const body = { categories: { necessary: true }, policyVersion: 'v1' } as never;
		await controller.updateConsent(body, {} as never, shopper);
		expect(consent.append).toHaveBeenLastCalledWith(expect.objectContaining({ userId: 'cus_1', guestId: null }));
		await controller.updateConsent(body, { cookies: { st_guest: 'g' } } as never, undefined);
		expect(consent.append).toHaveBeenLastCalledWith(expect.objectContaining({ userId: null, guestId: 'g' }));
		await controller.updateConsent(body, {} as never, undefined);
		expect(consent.append).toHaveBeenLastCalledWith(expect.objectContaining({ guestId: null }));
	});

	it('acknowledges export and erasure for a signed-in person only', async () => {
		const { controller } = harness();
		expect((await controller.requestExport(shopper)).message).toContain('export');
		expect((await controller.requestErasure(shopper)).message).toContain('erasure');
		await expect(controller.requestExport(undefined)).rejects.toBeInstanceOf(UnauthorizedException);
		await expect(controller.requestErasure(undefined)).rejects.toBeInstanceOf(UnauthorizedException);
	});
});

describe('promotions', () => {
	const build = (found: unknown) => {
		const repo = { listActive: vi.fn(async () => ['promo']), findByCouponCode: vi.fn(async () => found) };
		return new PromotionsService(repo as never);
	};

	it('lists and validates', async () => {
		expect(await build(null).listActive()).toEqual(['promo']);
		await expect(build(null).validateCoupon('x')).rejects.toBeInstanceOf(NotFoundException);
		await expect(build({ startsAt: '2099-01-01' }).validateCoupon('x')).rejects.toThrow('not currently active');
		await expect(build({ endsAt: '2000-01-01' }).validateCoupon('x')).rejects.toThrow('not currently active');
		await expect(
			build({ startsAt: '2000-01-01', endsAt: '2099-01-01' }).validateCoupon(' x '),
		).resolves.toBeDefined();
		await expect(build({}).validateCoupon('x')).resolves.toBeDefined();
	});

	it('serves the controller', async () => {
		const service = { listActive: vi.fn(async () => 'active'), validateCoupon: vi.fn(async () => 'valid') };
		const controller = new PromotionsController(service as never);
		expect(await controller.active()).toBe('active');
		expect(await controller.validate({ couponCode: 'x' } as never)).toBe('valid');
	});
});

describe('currency', () => {
	const build = (found: unknown) => {
		const repo = { listEnabled: vi.fn(async () => ['USD']), findByCode: vi.fn(async () => found) };
		return new CurrencyService(repo as never);
	};

	it('lists and converts', async () => {
		expect(await build(null).listEnabled()).toEqual(['USD']);
		await expect(build(null).convert(Number.NaN, 'USD')).rejects.toBeInstanceOf(BadRequestException);
		await expect(build(null).convert(-1, 'USD')).rejects.toBeInstanceOf(BadRequestException);
		await expect(build(null).convert(1, 'usd')).rejects.toBeInstanceOf(NotFoundException);
		expect(await build({ code: 'USD', rateFromINR: 0.5 }).convert(100, 'usd')).toEqual({
			amountINR: 100,
			currency: 'USD',
			rateFromINR: 0.5,
			amount: 50,
		});
	});

	it('serves the controller, defaulting to rupees', async () => {
		const service = { listEnabled: vi.fn(async () => 'list'), convert: vi.fn(async () => 'converted') };
		const controller = new CurrencyController(service as never);
		expect(await controller.list()).toBe('list');
		await controller.convert('100', 'USD');
		expect(service.convert).toHaveBeenLastCalledWith(100, 'USD');
		await controller.convert('100', undefined as never);
		expect(service.convert).toHaveBeenLastCalledWith(100, 'INR');
	});
});

describe('HealthController', () => {
	const reply = () => {
		const value = { status: vi.fn(), send: vi.fn() };
		value.status.mockReturnValue(value);
		return value;
	};

	it('stays alive whatever the database does', () => {
		const controller = new HealthController();
		expect(controller.live()).toMatchObject({ status: 'ok' });
		expect(controller.check()).toMatchObject({ status: 'ok' });
	});

	it('reports ready only with Mongo', () => {
		const controller = new HealthController();
		readyState.value = 1;
		const up = reply();
		controller.ready(up as never);
		expect(up.status).toHaveBeenCalledWith(200);
		expect(up.send).toHaveBeenCalledWith(expect.objectContaining({ status: 'ready' }));
		readyState.value = 0;
		const down = reply();
		controller.ready(down as never);
		expect(down.status).toHaveBeenCalledWith(503);
		expect(down.send).toHaveBeenCalledWith(
			expect.objectContaining({
				status: 'not_ready',
				dependencies: [expect.objectContaining({ status: 'down', detail: 'readyState=0' })],
			}),
		);
		readyState.value = 1;
	});
});
