import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { TranslocoService } from '@jsverse/transloco';
import { of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { currencyDisplayName } from '@core/fx/fx.gateway';
import { ShippingGateway } from '@core/shipping/shipping.gateway';
import { AuthStore } from '@core/state/auth.store';

import { SrbTry } from './srb-try';

import type {
	ShippingCartTryResult,
	ShippingRuleSetBody,
	ShippingTryLineView,
	ShippingTryResult,
} from '@saha-textile/contracts';

const h = vi.hoisted(() => ({
	fx: undefined as unknown,
	fxEnabled: null as null | (() => boolean),
	figures: new Map<string, { amountINR: number | null }>(),
	explanation: 'explained',
}));
vi.mock('@core/fx/fx.gateway', async (original) => {
	const { signal: make } = await import('@angular/core');
	return {
		...(await original<typeof import('@core/fx/fx.gateway')>()),
		injectFxOverviewQuery: (enabled: () => boolean) => {
			h.fxEnabled = enabled;
			return { data: make(h.fx) };
		},
	};
});
vi.mock('@core/shipping/try-words', async (original) => ({
	...(await original<typeof import('@core/shipping/try-words')>()),
	lineFigures: () => h.figures,
	lineSubline: () => 'sub',
	tryExplanation: () => h.explanation,
}));

const t = (key: string, params?: Record<string, unknown>) =>
	params ? `${key}(${Object.values(params).join('|')})` : key;

const BODY: ShippingRuleSetBody = { steps: [], adjust: [] };

function view(lineId: string, change: Partial<ShippingTryLineView> = {}): ShippingTryLineView {
	return {
		lineId,
		productId: 'p1',
		title: 'Silk',
		units: 1,
		sellingPriceINR: 1000,
		mrpINR: null,
		discounted: false,
		charges: {},
		chargeableWeightGrams: null,
		variantLabel: null,
		imageUrl: null,
		...change,
	} as ShippingTryLineView;
}

function ruleSetResult(change: Partial<ShippingTryResult> = {}): ShippingTryResult {
	return {
		status: 'priced',
		zone: 'domestic',
		amountINR: 100,
		lines: [view('l1')],
		trace: [],
		adjustments: [],
		cantShip: [],
		noResult: [],
		moreLines: 0,
		...change,
	};
}

type CartLine = ShippingCartTryResult['lines'][number];
function cartLine(lineId: string, change: Partial<CartLine>): CartLine {
	return {
		...view(lineId),
		route: 'ruleSet',
		via: 'siteWide',
		ruleSetId: 'rs_1',
		ruleSetName: 'Domestic',
		...change,
	} as CartLine;
}

function cartResult(change: Partial<ShippingCartTryResult> = {}): ShippingCartTryResult {
	return {
		status: 'priced',
		zone: 'international',
		amountINR: 3000,
		lines: [],
		groups: [],
		cantShip: [],
		...change,
	} as ShippingCartTryResult;
}

function tester(options: { permissions?: string[]; lang?: string } = {}) {
	const gateway = {
		tryIt: vi.fn(() => of(ruleSetResult())),
		tryCart: vi.fn(() => of(cartResult())),
		searchProducts: vi.fn(() => of({ items: [{ id: 'p1', title: 'Silk' }] })),
	};
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{ provide: ShippingGateway, useValue: gateway },
			{
				provide: TranslocoService,
				useValue: { translate: t, getActiveLang: () => options.lang ?? 'en' },
			},
			{ provide: AuthStore, useValue: { permissions: signal(options.permissions ?? ['currency.index']) } },
		],
	});
	TestBed.overrideComponent(SrbTry, { set: { imports: [], template: '' } });
	const fixture = TestBed.createComponent(SrbTry);
	const kept: unknown[] = [];
	fixture.componentInstance.saveTestCart.subscribe((cart) => kept.push(cart));
	return { fixture, c: fixture.componentInstance, gateway, kept };
}

const run = async () => {
	TestBed.tick();
	await vi.advanceTimersByTimeAsync(450);
};

beforeEach(() => {
	vi.useFakeTimers();
});
afterEach(() => {
	vi.useRealTimers();
	h.fx = undefined;
	h.figures = new Map();
	h.explanation = 'explained';
});

describe('Try it in the rule builder (rb02, rb05, rb07)', () => {
	it('prices the blocks as they stand once a product is in the cart', async () => {
		const { fixture, c, gateway } = tester();
		await run();
		expect(gateway.tryIt).not.toHaveBeenCalled();
		expect(c.request()).toBeNull();
		c.pick({ id: 'p1', title: 'Silk' } as never);
		await run();
		expect(gateway.tryIt).toHaveBeenCalledWith(
			expect.objectContaining({
				body: { steps: [], adjust: [] },
				delivery: { country: 'IN', state: 'West Bengal', pincode: '700001' },
			}),
		);
		expect(c.outcome()?.status).toBe('priced');
		fixture.componentRef.setInput('body', BODY);
		c.pick({ id: 'p1', title: 'Silk' } as never);
		await run();
		expect(gateway.tryIt).toHaveBeenLastCalledWith(expect.objectContaining({ body: BODY }));
		expect(c.lines()[0]?.quantity).toBe(2);
	});

	it('asks nothing while the blocks have mistakes or no result, and shows a refusal', async () => {
		const { fixture, c, gateway } = tester();
		c.pick({ id: 'p1', title: 'Silk' } as never);
		fixture.componentRef.setInput('blocked', true);
		await run();
		expect(gateway.tryIt).not.toHaveBeenCalled();
		fixture.componentRef.setInput('blocked', false);
		fixture.componentRef.setInput('pending', true);
		await run();
		expect(gateway.tryIt).not.toHaveBeenCalled();
		fixture.componentRef.setInput('pending', false);
		gateway.tryIt.mockReturnValueOnce(throwError(() => ({ error: { issues: [{ code: 'ship_x' }] } })));
		await run();
		expect(c.problem()).not.toBeNull();
		expect(c.outcome()).toBeNull();
		c.setQuantity(0, 5);
		await run();
		expect(c.problem()).toBeNull();
	});

	it('starts an international rule set with a cart to the United Kingdom, and reads other addresses', async () => {
		const { fixture, c, gateway } = tester();
		fixture.componentRef.setInput('use', 'international');
		TestBed.tick();
		expect(c.destination()).toBe('gb');
		c.pick({ id: 'p1', title: 'Silk' } as never);
		await run();
		expect(gateway.tryIt).toHaveBeenLastCalledWith(
			expect.objectContaining({ delivery: { country: 'GB', state: null, pincode: null } }),
		);
		c.destination.set('other');
		c.otherCountry.set(' in ');
		c.otherState.set('  ');
		c.otherPincode.set(' ');
		expect(c.request()?.delivery).toEqual({ country: 'IN', state: null, pincode: null });
		c.otherState.set(' Assam ');
		c.otherPincode.set(' 781001 ');
		expect(c.request()?.delivery).toEqual({ country: 'IN', state: 'Assam', pincode: '781001' });
		c.otherCountry.set('de');
		expect(c.request()?.delivery).toEqual({ country: 'DE', state: null, pincode: '781001' });
	});

	it('searches products, adds them, sets quantities and removes lines', async () => {
		const { c, gateway } = tester();
		c.search(' s ');
		expect(gateway.searchProducts).not.toHaveBeenCalled();
		expect(c.results()).toEqual([]);
		c.search('silk ');
		expect(gateway.searchProducts).toHaveBeenCalledWith('silk');
		expect(c.results()).toHaveLength(1);
		const box = document.createElement('input');
		box.value = 'silk';
		Object.defineProperty(c, 'searchBox', { value: () => ({ nativeElement: box }) });
		c.pick({ id: 'p2', title: 'Cotton' } as never);
		expect(box.value).toBe('');
		expect(c.results()).toEqual([]);
		expect(c.query()).toBe('');
		c.setQuantity(0, 'many');
		expect(c.lines()[0]?.quantity).toBe(1);
		c.setQuantity(0, 500);
		expect(c.lines()[0]?.quantity).toBe(99);
		c.pick({ id: 'p2', title: 'Cotton' } as never);
		expect(c.lines()[0]?.quantity).toBe(99);
		c.pick({ id: 'p3', title: 'Linen' } as never);
		c.removeLine(0);
		expect(c.lines().map((line) => line.productId)).toEqual(['p3']);
	});

	it('names countries, currencies and the preset destinations', () => {
		const { c } = tester();
		expect(c.countryName('GB')).toBe('United Kingdom');
		expect(c.countryName('not a code')).toBe('not a code');
		expect(c.currencyName('USD')).toBe('US Dollar');
		expect(c.currencyName('GBP')).toBe('fx_name_GBP');
		expect(currencyDisplayName('not a code', 'en', t)).toBe('not a code');
		expect(c.destinationLabel(c.destinations[0] as never)).toBe('India · Kolkata 700001');
		expect(c.destinationLabel({ key: 'gb', country: 'GB', city: 'London', state: null, pincode: null })).toBe(
			'United Kingdom · London',
		);
		expect(c.countries).toContain('BD');
	});

	it('shows the shopper’s currency at checkout, with the PayPal markup', async () => {
		h.fx = {
			currencies: [
				{ code: 'GBP', symbol: '£', stored: true, enabled: true, inrPerUnit: 100 },
				{ code: 'USD', symbol: 'US$', stored: true, enabled: false, inrPerUnit: 80 },
				{ code: 'EUR', symbol: '€', stored: false, enabled: true, inrPerUnit: 90 },
				{ code: 'AUD', symbol: 'A$', stored: true, enabled: true, inrPerUnit: null },
			],
			settings: { paypalMarkupPercent: 4 },
		};
		const { c } = tester();
		expect(h.fxEnabled?.()).toBe(true);
		expect(c.shopperCurrencies().map((row) => row.code)).toEqual(['GBP']);
		expect(c.shownAs()).toBeNull();
		c.outcome.set(ruleSetResult({ amountINR: null }));
		expect(c.shownAs()).toBeNull();
		c.outcome.set(ruleSetResult({ amountINR: 3000 }));
		expect(c.shownAs()).toBeNull();
		c.currency.set('GBP');
		expect(c.shownAs()).toMatch(/^£\d+\.\d\d$/);
		h.fx = {
			currencies: [{ code: 'GBP', symbol: '£', stored: true, enabled: true, inrPerUnit: 100 }],
			settings: {},
		};
		const noMarkup = tester({ permissions: [] });
		expect(h.fxEnabled?.()).toBe(false);
		noMarkup.c.currency.set('GBP');
		noMarkup.c.outcome.set(ruleSetResult({ amountINR: 3000 }));
		expect(noMarkup.c.shownAs()).toBeNull();
		h.fx = undefined;
		const none = tester();
		expect(none.c.shopperCurrencies()).toEqual([]);
	});

	it('explains each line, the total and why, for a rule set', () => {
		const { fixture, c } = tester();
		expect(c.trace()).toEqual([]);
		expect(c.why()).toBe('');
		expect(c.total()).toBeNull();
		expect(c.subline(view('l1'))).toBe('sub');
		h.figures = new Map([
			['l1', { amountINR: 250 }],
			['l2', { amountINR: null }],
		]);
		fixture.componentRef.setInput('body', BODY);
		c.outcome.set(ruleSetResult({ trace: [{ stepId: 's' } as never] }));
		expect(c.trace()).toHaveLength(1);
		expect(c.views()).toHaveLength(1);
		expect(c.total()).toBe(100);
		expect(c.lineAmount(view('l1'))).toBe('₹250');
		expect(c.lineAmount(view('l2'))).toBe('');
		expect(c.lineAmount(view('l3'))).toBe('');
		expect(c.subline(view('l1', { variantLabel: 'Red' }))).toBe('Red · sub');
		expect(c.why()).toBe('explained');
		c.outcome.set(
			ruleSetResult({ status: 'cantShip', cantShip: [{ lineId: 'l1', message: { en: 'Too heavy' } }] }),
		);
		expect(c.why()).toBe('ship_try_cant_ship(Too heavy)');
		c.outcome.set(ruleSetResult({ status: 'cantShip', cantShip: [] }));
		expect(c.why()).toBe('ship_try_cant_ship()');
		c.outcome.set(ruleSetResult({ status: 'noResult' }));
		expect(c.why()).toBe('ship_try_no_result');
		c.outcome.set(ruleSetResult({ status: 'needsQuote' }));
		expect(c.why()).toBe('ship_try_needs_quote');
	});

	it('keeps a named test cart, with the address as asked', async () => {
		const { c, kept } = tester();
		c.naming.set(true);
		c.keep();
		expect(kept).toEqual([]);
		c.cartName.set('  Two sarees to Kolkata  ');
		c.keep();
		expect(kept).toEqual([]);
		c.pick({ id: 'p1', title: 'Silk' } as never);
		c.keep();
		expect(kept[0]).toMatchObject({
			name: 'Two sarees to Kolkata',
			lines: [{ productId: 'p1', variationId: null, quantity: 1 }],
			delivery: { country: 'IN', state: 'West Bengal', pincode: '700001' },
			expectedINR: null,
		});
		expect(c.naming()).toBe(false);
		expect(c.cartName()).toBe('');
		c.destination.set('us');
		c.cartName.set('x'.repeat(100));
		c.keep();
		expect(kept[1]).toMatchObject({ delivery: { country: 'US', state: null, pincode: null } });
		expect((kept[1] as { name: string }).name).toHaveLength(80);
	});
});

describe('Try it on the Overview (ov01, live settings)', () => {
	it('prices with the live settings and explains each group', async () => {
		const { fixture, c, gateway } = tester();
		fixture.componentRef.setInput('mode', 'live');
		fixture.componentRef.setInput('blocked', true);
		c.pick({ id: 'p1', title: 'Silk' } as never);
		await run();
		expect(gateway.tryCart).toHaveBeenCalled();
		expect(gateway.tryIt).not.toHaveBeenCalled();
		const lines = [
			cartLine('l1', { via: 'freeShippingSwitch' }),
			cartLine('l2', { via: 'indiaOnly' }),
			cartLine('l3', { via: 'productException', route: 'free' }),
			cartLine('l4', { via: 'categoryException', route: 'cantShip' }),
			cartLine('l5', { route: 'ruleSet', ruleSetName: null }),
			cartLine('l6', { route: 'ruleSet' }),
		];
		c.outcome.set(
			cartResult({
				lines,
				groups: [
					{
						kind: 'free',
						ruleSetId: null,
						ruleSetName: null,
						version: null,
						body: null,
						lineIds: ['l1'],
						amountINR: 0,
						trace: [{ stepId: 'a' }],
					},
					{
						kind: 'ruleSet',
						ruleSetId: 'rs_1',
						ruleSetName: null,
						version: null,
						body: null,
						lineIds: ['l5'],
						amountINR: 500,
						trace: [],
					},
					{
						kind: 'ruleSet',
						ruleSetId: 'rs_2',
						ruleSetName: 'Intl',
						version: 3,
						body: BODY,
						lineIds: ['l6'],
						amountINR: 2500,
						trace: [{ stepId: 'b' }],
					},
				] as never,
			}),
		);
		expect(c.trace()).toHaveLength(2);
		const subs = lines.map((line) => c.subline(line));
		expect(subs).toEqual([
			'sub · ship_route_free_switch',
			'sub · ship_route_india_only',
			'sub · ship_route_exception(ship_choice_free)',
			'sub · ship_route_exception(ship_choice_cantShip)',
			'sub · ship_zone_unset',
			'sub · Domestic',
		]);
		expect(c.subline(view('l_gone'))).toBe('sub');
		expect(c.why()).toBe(
			'ship_tester_group_free(₹0) ship_tester_group(ship_zone_unset|0|₹500) ship_tester_group(Intl|3|₹2,500) explained',
		);
		h.explanation = '';
		expect(c.why()).toContain('ship_tester_group(Intl|3|₹2,500)');
		c.outcome.set(cartResult({ status: 'unpriced' }));
		expect(c.why()).toBe('ship_try_unpriced');
	});

	it('reads the blocks of every rule set used when it has none of its own', () => {
		const { fixture, c } = tester();
		c.outcome.set(
			cartResult({
				groups: [
					{ kind: 'ruleSet', body: { steps: [{ id: 's1' }], adjust: [] }, trace: [] },
					{ kind: 'free', body: null, trace: [] },
				] as never,
			}),
		);
		// Builder mode with groups still explains the blocks as one.
		expect(c.why()).toBe('explained');
		c.outcome.set(ruleSetResult());
		expect(c.why()).toBe('explained');
		fixture.componentRef.setInput('mode', 'live');
		c.outcome.set(null);
		expect(c.subline(view('l1'))).toBe('sub');
	});
});
