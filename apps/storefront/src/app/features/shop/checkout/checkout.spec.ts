import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { TranslocoService } from '@jsverse/transloco';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { CheckoutGateway } from '@core/checkout/checkout.gateway';
import { AccountStore } from '@core/state/account.store';
import { CartFacade } from '@core/state/cart/cart.facade';
import { SettingStore } from '@core/state/setting.store';

import { Checkout, shopMoney } from './checkout';
import { PaymentCurrencyPopup } from './payment-currency-popup/payment-currency-popup';

const quoteData = signal<unknown>(undefined);
const CART = { lines: [{ id: 'l1', mrpINR: 12_000, unitPriceINR: 10_200, image: null }] };
const cartData = signal<unknown>(CART);
const currencyData = signal<unknown>([
	{ code: 'INR', symbol: '₹', enabled: true, rateFromINR: 1, shopRateFromINR: 1 },
	{ code: 'USD', symbol: 'US$', enabled: true, rateFromINR: 0.012, shopRateFromINR: 0.01272 },
]);
vi.mock('@tanstack/angular-query-experimental', async (original) => ({
	...(await original<typeof import('@tanstack/angular-query-experimental')>()),
	injectQuery: (options: () => { queryKey: unknown[] }) => {
		const key = options().queryKey;
		if (key[1] === 'quote') return { data: quoteData, isError: () => false, refetch: vi.fn() };
		return key[1] === 'currencies' ? { data: currencyData } : { data: cartData, refetch: vi.fn() };
	},
}));
vi.mock('@core/geo/geo.gateway', () => ({ injectGeoCountryQuery: () => ({ data: () => null }) }));

const t = (key: string, params?: Record<string, unknown>) =>
	params ? `${key}(${Object.values(params).join(',')})` : key;

const render = (currency = 'INR') => {
	const setCurrency = vi.fn();
	const place = vi.fn(() =>
		of({ orderId: 'o1', orderNumber: 'ST-2611-1', handoff: { kind: 'redirect', url: 'https://pay' } }),
	);
	const popup = { kind: signal('chooseCurrency'), first: signal<string | null>(null) };
	const open = vi.fn(() => ({ componentInstance: popup }));
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			provideRouter([]),
			{ provide: NgbModal, useValue: { open } },
			{ provide: TranslocoService, useValue: { selectTranslate: () => of(''), translate: t } },
			{ provide: CheckoutGateway, useValue: { place } },
			{
				provide: AccountStore,
				useValue: { user: () => ({ address: [{ address_id: 'adr_home', is_default: true, title: 'Home' }] }) },
			},
			{ provide: SettingStore, useValue: { selectedCurrency: () => ({ code: currency }), setCurrency } },
			{ provide: CartFacade, useValue: { deleteCart: vi.fn() } },
		],
	});
	TestBed.overrideComponent(Checkout, { set: { imports: [], template: '' } });
	return { page: TestBed.createComponent(Checkout).componentInstance, place, open, popup, setCurrency };
};

const quote = (over: Record<string, unknown> = {}) => ({
	currency: 'INR',
	lines: [
		{
			lineId: 'l1',
			title: 'Red Banarasi',
			quantity: 2,
			unitPrice: 10_200,
			lineTotal: 20_400,
			couponAmount: 0,
			cannotShipReason: null,
		},
	],
	shipping: {
		charge: 200,
		chargeINR: 200,
		zone: 'domestic',
		reason: [
			JSON.stringify({ result: 'productCharge', units: 2, unitAmountINR: 100, amountINR: 200, lineIds: ['l1'] }),
			JSON.stringify({ result: 'free', amountINR: 0, lineIds: ['l2'] }),
		],
	},
	coupons: [],
	couponRefusals: [],
	totals: { goods: 22_850, coupon: 0, shipping: 200, total: 23_050, totalINR: 23_050 },
	showAddressInIndia: false,
	notes: [],
	currencyPicker: null,
	payBlocked: null,
	...over,
});

describe('Shop checkout (shop01–shop17)', () => {
	it('starts on the default saved address, with billing the same as delivery', () => {
		const { page } = render();
		expect(page.delivery()).toBe('adr_home');
		expect(page.request()).toMatchObject({
			delivery: { kind: 'saved', savedAddressId: 'adr_home' },
			billing: null,
			currency: 'INR',
		});
	});

	it('words the shipping line, the MRP line and the Pay button as drawn (shop01, shop03)', () => {
		const { page } = render();
		quoteData.set(quote());
		expect(page.shippingWhy()).toBe('chk_ship_discounted_other(2,₹100) · chk_ship_full_price_free');
		expect(page.lineSub(quote().lines[0] as never)).toBe('chk_line_mrp_discounted(₹12,000)');
		expect(page.payWords()).toBe('chk_pay_amount(₹23,050)');
		quoteData.set(
			quote({
				currency: 'GBP',
				totals: { goods: 246.53, coupon: 0, shipping: 34.44, total: 280.97, totalINR: 31_000 },
			}),
		);
		expect(page.payWords()).toBe(`chk_pay_paypal(${shopMoney(280.97, 'GBP')})`);
		quoteData.set(
			quote({
				shipping: {
					charge: 0,
					chargeINR: 0,
					zone: 'international',
					reason: [
						JSON.stringify({
							result: 'firstAndFurther',
							furtherUnits: 2,
							amountINR: 3_800,
							lineIds: ['l1'],
						}),
					],
				},
			}),
		);
		expect(page.shippingWhy()).toBe('chk_ship_abroad(2)');
	});

	it('switches currency with the shop’s own row, its rate included, so every price follows', () => {
		const { page, setCurrency } = render('USD');
		page.useCurrency('USD', 'US$');
		expect(setCurrency).toHaveBeenLastCalledWith(
			expect.objectContaining({ code: 'USD', symbol: 'US$', exchange_rate: 0.01272 }),
		);
		page.payInRupees();
		expect(setCurrency).toHaveBeenLastCalledWith(expect.objectContaining({ code: 'INR', exchange_rate: 1 }));
		// A currency the list doesn't hold keeps the old way: its code and symbol.
		page.useCurrency('GBP', '£');
		expect(setCurrency).toHaveBeenLastCalledWith({ code: 'GBP', symbol: '£' });
	});

	it('says on Pay why it is off, and marks the piece that stops it (owner, 21 Nov: option 1)', () => {
		const { page } = render();
		for (const [reason, words] of [
			['cartEmpty', 'chk_pay_off_cartEmpty'],
			['lineProblem', 'chk_pay_off_lineProblem'],
			['deliveryAbroadNotOffered', 'chk_pay_off_deliveryAbroadNotOffered'],
			['noGateway', 'chk_pay_off_noGateway'],
		]) {
			quoteData.set(quote({ payBlocked: reason }));
			expect(page.payWords()).toBe(words);
		}
		expect(page.problemWords('l1')).toBe('');
		cartData.set({ lines: [{ ...CART.lines[0], problem: 'out_of_stock' }] });
		expect(page.problemWords('l1')).toBe('cart_line_out_of_stock()');
		cartData.set({ lines: [{ ...CART.lines[0], problem: 'below_shortest_cut', shortestCutTenths: 25 }] });
		expect(page.problemWords('l1')).toMatch(/^cart_line_below_shortest_cut\(2\.5/);
		// Too few left lowers the quantity but doesn't stop Pay, so nothing is marked.
		cartData.set({ lines: [{ ...CART.lines[0], problem: 'limited' }] });
		expect(page.problemWords('l1')).toBe('');
		cartData.set(CART);
	});

	it('keeps Pay off while a piece can’t be sent, and says so (shop06)', async () => {
		const { page, place } = render();
		quoteData.set(quote({ payBlocked: 'pieceCannotShip' }));
		expect(page.payWords()).toBe('chk_remove_cannot_ship');
		await page.pay();
		expect(place).not.toHaveBeenCalled();
	});

	it('adds and removes coupons, and explains a refusal (shop12, shop13)', () => {
		const { page } = render();
		page.couponInput.set('wedding10');
		page.applyCoupon();
		page.couponInput.set('FREESHIP');
		page.applyCoupon();
		expect(page.couponCodes()).toEqual(['WEDDING10', 'FREESHIP']);
		quoteData.set(quote());
		expect(page.refusalWords('WELCOME500', 'doesNotCombine')).toBe(
			'chk_coupon_refusal_doesNotCombine(WELCOME500,WEDDING10 and FREESHIP)',
		);
		expect(page.refusalWords('WEDDING10', 'nothingEligible')).toBe(
			'chk_coupon_refusal_allOnSale(WEDDING10,FREESHIP)',
		);
		page.removeCoupon('WEDDING10');
		expect(page.couponCodes()).toEqual(['FREESHIP']);
	});

	it('opens the approved currency popup over the checkout after an unpaid return, once (shop04, shop05)', () => {
		const { page, open, popup } = render();
		history.replaceState({ paymentOutcome: { popup: 'switchToRegionCurrency', firstCurrency: 'GBP' } }, '');
		page.afterGatewayReturn();
		expect(open).toHaveBeenCalledWith(PaymentCurrencyPopup, {
			ariaLabelledBy: 'currency-popup-title',
			centered: true,
			windowClass: 'theme-modal text-center',
		});
		expect(popup.kind()).toBe('switchToRegionCurrency');
		expect(popup.first()).toBe('GBP');
		// The hand-over is cleared, so a reload or Back never opens it again.
		expect((history.state as { paymentOutcome?: unknown }).paymentOutcome).toBeUndefined();
		page.afterGatewayReturn();
		expect(open).toHaveBeenCalledTimes(1);
	});

	it('says a payment didn’t go through when the gateway’s answer calls for no popup', () => {
		const { page, open } = render();
		history.replaceState({ paymentOutcome: { popup: null, firstCurrency: null } }, '');
		page.afterGatewayReturn();
		expect(open).not.toHaveBeenCalled();
		expect(page.error()).toBe('ret_failed_text');
	});

	it('asks a guest to sign in first: guest checkout is off at launch (OD6)', async () => {
		const page = await import('../../../pages/checkout/index.page');
		const { AuthGuard } = await import('@core/guards/auth.guard');
		expect(page.routeMeta.canActivate).toContain(AuthGuard);
	});
});
