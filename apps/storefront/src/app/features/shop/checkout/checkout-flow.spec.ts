import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { TranslocoService } from '@jsverse/transloco';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { of, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CheckoutGateway, followHandoff } from '@core/checkout/checkout.gateway';
import { AccountStore } from '@core/state/account.store';
import { CartFacade } from '@core/state/cart/cart.facade';
import { SettingStore } from '@core/state/setting.store';

import { Checkout, shopMoney } from './checkout';

interface Options {
	queryKey: unknown[];
	queryFn: () => Promise<unknown>;
	enabled?: boolean;
}
const held = vi.hoisted(() => ({ options: new Map<string, () => Options>(), india: '' as string | null }));
const quoteData = signal<unknown>(undefined);
const cartData = signal<unknown>(undefined);
const currencyData = signal<unknown>(undefined);
const refetch = vi.fn();

vi.mock('@tanstack/angular-query-experimental', async (original) => ({
	...(await original<typeof import('@tanstack/angular-query-experimental')>()),
	injectQuery: (options: () => Options) => {
		const name = String(options().queryKey[1]);
		held.options.set(name, options);
		if (name === 'quote') return { data: quoteData };
		return name === 'currencies' ? { data: currencyData } : { data: cartData, refetch };
	},
}));
vi.mock('@core/geo/geo.gateway', () => ({
	injectGeoCountryQuery: (code: () => string | null) => {
		held.india = code();
		return { data: () => null };
	},
}));
vi.mock('@core/checkout/checkout.gateway', async (original) => ({
	...(await original<typeof import('@core/checkout/checkout.gateway')>()),
	followHandoff: vi.fn(),
}));

const t = (key: string, params?: Record<string, unknown>) =>
	params ? `${key}(${Object.values(params).join(',')})` : key;

const TYPED = {
	fullName: 'Asha',
	line1: '12 Park Street',
	city: 'Kolkata',
	postalCode: '700016',
	countryCode: 'IN',
	mobile: { countryCallingCode: '91', number: '9830012345' },
};

const render = ({
	user = { address: [{ address_id: 'adr_home', is_default: true }] } as unknown,
	currency = { code: 'INR' } as unknown,
	gateway = {} as Record<string, unknown>,
} = {}) => {
	const setCurrency = vi.fn();
	const deleteCart = vi.fn();
	const open = vi.fn(() => ({ componentInstance: { kind: signal(null), first: signal(null) } }));
	const place = vi.fn(() => of({ handoff: { kind: 'redirect', url: 'https://pay.example' } }));
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			provideRouter([]),
			{ provide: NgbModal, useValue: { open } },
			{ provide: TranslocoService, useValue: { selectTranslate: () => of(''), translate: t } },
			{
				provide: CheckoutGateway,
				useValue: {
					place,
					quote: vi.fn(() => of({ quoted: true })),
					cart: vi.fn(() => of({ lines: [] })),
					currencies: vi.fn(() => of([])),
					...gateway,
				},
			},
			{ provide: AccountStore, useValue: { user: () => user } },
			{ provide: SettingStore, useValue: { selectedCurrency: () => currency, setCurrency } },
			{ provide: CartFacade, useValue: { deleteCart } },
		],
	});
	TestBed.overrideComponent(Checkout, { set: { imports: [], template: '' } });
	const fixture = TestBed.createComponent(Checkout);
	return { fixture, page: fixture.componentInstance, place, open, setCurrency, deleteCart };
};

const quote = (over: Record<string, unknown> = {}) => ({
	currency: 'INR',
	lines: [{ lineId: 'l1', couponAmount: 0 }],
	shipping: { reason: [] as string[] },
	coupons: [] as unknown[],
	totals: { total: 1_000, totalINR: 1_000 },
	payBlocked: null,
	...over,
});
const reason = (entry: Record<string, unknown>) => JSON.stringify({ amountINR: 0, lineIds: ['l1'], ...entry });

afterEach(() => {
	quoteData.set(undefined);
	cartData.set(undefined);
	currencyData.set(undefined);
	refetch.mockClear();
	vi.mocked(followHandoff).mockClear();
	history.replaceState(null, '');
});

describe('shopMoney', () => {
	it('writes rupees whole, other currencies with two decimals, and a code the browser cannot format plainly', () => {
		expect(shopMoney(1234.6, 'INR')).toBe('₹1,235');
		expect(shopMoney(12.5, 'GBP')).toBe('£12.50');
		expect(shopMoney(1.5, 'NOT-A-CODE')).toBe('NOT-A-CODE 1.50');
	});
});

describe('Shop checkout: choices, queries and actions', () => {
	it('asks for India’s States, and prices, reads the cart and the currencies through the gateway', async () => {
		const { page } = render();
		expect(held.india).toBe('IN');
		const options = (name: string) => held.options.get(name)?.() as Options;
		expect(options('quote').enabled).toBe(true);
		await expect(options('quote').queryFn()).resolves.toEqual({ quoted: true });
		await expect(options('cart').queryFn()).resolves.toEqual({ lines: [] });
		await expect(options('currencies').queryFn()).resolves.toEqual([]);
		page.pickDelivery('new');
		expect(options('quote').enabled).toBe(false);
	});

	it('starts on a new address with no account or none saved, else the first when none is the default', () => {
		expect(render({ user: null }).page.delivery()).toBe('new');
		expect(render({ user: { address: [{ address_id: 'a1' }, { address_id: 'a2' }] } }).page.delivery()).toBe('a1');
	});

	it('prices in rupees when no currency is chosen', () => {
		const { page } = render({ currency: null });
		expect(page.currency()).toBe('INR');
		expect(page.money(10)).toBe('₹10');
	});

	it('builds the request from a new delivery address, saving it under a name only when asked', () => {
		const { page } = render();
		page.pickDelivery('new');
		expect(page.request()).toBeNull();

		page.newDelivery.set(TYPED as never);
		page.deliveryName.set('  Home  ');
		expect(page.request()?.delivery).toEqual({ kind: 'new', address: TYPED, saveAs: 'Home' });
		page.deliveryName.set(' ');
		expect(page.request()?.delivery).toMatchObject({ saveAs: null });
		page.deliveryName.set('Home');
		page.saveDelivery.set(false);
		expect(page.request()?.delivery).toMatchObject({ saveAs: null });
	});

	it('needs a complete billing address when it differs from delivery', () => {
		const { page } = render();
		page.billingSame.set(false);
		expect(page.billing()).toBe('adr_home');
		expect(page.request()?.billing).toEqual({ kind: 'saved', savedAddressId: 'adr_home' });

		page.pickBilling('new');
		expect(page.request()).toBeNull();
		page.newBilling.set(TYPED as never);
		page.saveBilling.set(true);
		page.billingName.set('Office');
		expect(page.request()?.billing).toEqual({ kind: 'new', address: TYPED, saveAs: 'Office' });
	});

	it('sends the Address in India only once something is typed in it', () => {
		const { page } = render();
		expect(page.request()?.addressInIndia).toBeNull();
		page.setIndia('city', 'Kolkata');
		expect(page.request()?.addressInIndia).toMatchObject({ city: 'Kolkata', line1: '' });
	});

	it('splits the free-delivery coupon from the goods coupons', () => {
		const { page } = render();
		expect(page.freeDelivery()).toBeNull();
		expect(page.goodsCoupons()).toEqual([]);
		quoteData.set(quote({ coupons: [{ kind: 'freeDelivery' }, { kind: 'percent' }] }));
		expect(page.freeDelivery()).toEqual({ kind: 'freeDelivery' });
		expect(page.goodsCoupons()).toEqual([{ kind: 'percent' }]);
	});

	it('shows a coupon’s rupees in the order’s currency at the quote’s own rate', () => {
		const { page } = render();
		expect(page.couponMoney(500)).toBe('₹500');
		quoteData.set(quote());
		expect(page.couponMoney(500)).toBe('₹500');
		quoteData.set(quote({ currency: 'GBP', totals: { total: 10, totalINR: 1_000 } }));
		expect(page.couponMoney(500)).toBe('£5.00');
		quoteData.set(quote({ currency: 'GBP', totals: { total: 0, totalINR: 0 } }));
		expect(page.couponMoney(5)).toBe('£5.00');
	});

	it('pictures a line by its thumbnail, else its card picture, else the stand-in', () => {
		const { page } = render();
		expect(page.imageOf('l1')).toBe('assets/images/product.png');
		cartData.set({
			lines: [
				{ id: 'l1', image: { roles: { thumb: [{ url: 'thumb.webp' }], card: [{ url: 'card.webp' }] } } },
				{ id: 'l2', image: { roles: { card: [{ url: 'card.webp' }] } } },
				{ id: 'l3', image: { roles: {} } },
			],
		});
		expect(page.imageOf('l1')).toBe('thumb.webp');
		expect(page.imageOf('l2')).toBe('card.webp');
		expect(page.imageOf('l3')).toBe('assets/images/product.png');
	});

	it('marks a below-the-shortest-cut piece without a length when the cart gives none', () => {
		const { page } = render();
		cartData.set({ lines: [{ id: 'l1', problem: 'below_shortest_cut' }] });
		expect(page.problemWords('l1')).toBe('cart_line_below_shortest_cut()');
	});

	it('words a line: its coupon share, a sale piece left out of a coupon, full price', () => {
		const { page } = render();
		const line = { lineId: 'l1', couponAmount: 100 } as never;
		expect(page.lineSub(line)).toBe('');

		cartData.set({ lines: [{ id: 'l1', mrpINR: 2_000, unitPriceINR: 1_500 }] });
		quoteData.set(quote({ coupons: [{ code: 'WED10', lines: [{ lineId: 'l1', amountINR: 100, reason: null }] }] }));
		expect(page.lineSub(line)).toBe('chk_line_coupon(WED10,₹100)');

		quoteData.set(
			quote({ coupons: [{ code: 'WED10', lines: [{ lineId: 'l1', amountINR: 0, reason: 'onSale' }] }] }),
		);
		expect(page.lineSub(line)).toBe('chk_line_on_sale_left_out(₹2,000)');

		cartData.set({ lines: [{ id: 'l1', mrpINR: 1_500, unitPriceINR: 1_500 }] });
		expect(page.lineSub(line)).toBe('');
	});

	it('explains shipping from the engine’s reasons, skipping any it cannot read', () => {
		const { page } = render();
		expect(page.shippingWhy()).toBe('');

		quoteData.set(quote({ shipping: { reason: ['not json'] } }));
		expect(page.shippingWhy()).toBe('');

		quoteData.set(quote({ shipping: { reason: [reason({ result: 'free' })] } }));
		expect(page.shippingWhy()).toBe('chk_ship_all_free');

		quoteData.set(quote({ shipping: { reason: [reason({ result: 'productCharge', amountINR: 150 })] } }));
		expect(page.shippingWhy()).toBe('chk_ship_discounted_one(1,₹150)');

		quoteData.set(quote({ shipping: { reason: [reason({ result: 'firstAndFurther', amountINR: 900 })] } }));
		expect(page.shippingWhy()).toBe('chk_ship_abroad(0)');
	});

	it('words Pay before the first quote', () => {
		expect(render().page.payWords()).toBe('chk_pay');
	});

	it('takes each coupon code once, in capitals, and ignores an empty box', () => {
		const { page } = render();
		page.couponInput.set('  ');
		page.applyCoupon();
		page.couponInput.set('wed10');
		page.applyCoupon();
		page.couponInput.set('WED10');
		page.applyCoupon();
		expect(page.couponCodes()).toEqual(['WED10']);
		expect(page.couponInput()).toBe('WED10');
	});

	it('names the plain refusal when some pieces are full price, and the sale one with no quote yet', () => {
		const { page } = render();
		expect(page.refusalWords('WED10', 'nothingEligible')).toBe('chk_coupon_refusal_allOnSale(WED10,)');
		cartData.set({ lines: [{ id: 'l1', mrpINR: 1_000, unitPriceINR: 1_000 }] });
		quoteData.set(quote());
		expect(page.refusalWords('WED10', 'nothingEligible')).toBe('chk_coupon_refusal_nothingEligible(WED10,)');
		cartData.set({ lines: [] });
		expect(page.refusalWords('WED10', 'nothingEligible')).toBe('chk_coupon_refusal_nothingEligible(WED10,)');
	});

	it('offers the billing country’s currency first, without rupees', () => {
		const choices = render().page.pickerChoices('GBP');
		expect(choices[0].code).toBe('GBP');
		expect(choices.some((row) => row.code === 'INR')).toBe(false);
	});

	it('switches to a currency by its code alone before the shop’s list arrives', () => {
		const { page, setCurrency } = render({ currency: null });
		currencyData.set({ not: 'a list' });
		page.useCurrency('USD', 'US$');
		expect(setCurrency).toHaveBeenCalledWith({ code: 'USD', symbol: 'US$' });
	});

	it('looks for a gateway hand-over after the first render, and ignores a page with no window or no hand-over', () => {
		const { fixture, page, open } = render();
		const check = vi.spyOn(page, 'afterGatewayReturn');
		fixture.detectChanges();
		TestBed.tick();
		expect(check).toHaveBeenCalled();
		expect(open).not.toHaveBeenCalled();

		(page as unknown as { doc: Document }).doc = { defaultView: null } as unknown as Document;
		check.mockRestore();
		expect(() => page.afterGatewayReturn()).not.toThrow();
	});

	it('removes a line and reads the cart again', () => {
		const { page, deleteCart } = render();
		page.removeLine('l1');
		expect(deleteCart).toHaveBeenCalledWith('l1');
		expect(refetch).toHaveBeenCalled();
	});

	describe('Pay', () => {
		it('does nothing without a complete address, without a quote, or while a payment is starting', async () => {
			const { page, place } = render();
			await page.pay();
			quoteData.set(quote());
			page.busy.set(true);
			await page.pay();
			page.busy.set(false);
			page.pickDelivery('new');
			await page.pay();
			expect(place).not.toHaveBeenCalled();
		});

		it('places the order with a fresh idempotency key and follows the gateway’s hand-over', async () => {
			const { page, place } = render();
			quoteData.set(quote());
			await page.pay();
			expect(place).toHaveBeenCalledWith(
				expect.objectContaining({
					delivery: { kind: 'saved', savedAddressId: 'adr_home' },
					idempotencyKey: expect.stringMatching(/^shop-[0-9a-f-]{36}$/),
				}),
			);
			expect(followHandoff).toHaveBeenCalledWith({ kind: 'redirect', url: 'https://pay.example' }, document);
			expect(page.busy()).toBe(false);
			expect(page.error()).toBeNull();
		});

		it('says the payment could not start when placing fails', async () => {
			const { page } = render({ gateway: { place: () => throwError(() => new Error('down')) } });
			quoteData.set(quote());
			await page.pay();
			expect(page.error()).toBe('chk_pay_failed');
			expect(page.busy()).toBe(false);
			expect(followHandoff).not.toHaveBeenCalled();
		});
	});
});
