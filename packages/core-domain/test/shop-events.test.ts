import type { SaleRule, SaleSetup, ShopEvent } from '@saha-textile/contracts';
import { describe, expect, it } from 'vitest';

import {
	applySaleRule,
	dueTransition,
	publicShopEvent,
	resolveSaleRule,
	saleRuleProblem,
	salePriceINR,
	saleRunsAt,
	saleWarning,
	shopEventPublishProblems,
	shopEventSaveProblems,
	windowsOverlap,
} from '../src/events/index';

const rule = (kind: SaleRule['kind'], value: number, skuPrices: Record<string, number> = {}): SaleRule => ({
	kind,
	value,
	skuPrices,
});

const sale = (partial: Partial<ShopEvent> = {}): ShopEvent => ({
	id: 'evt_1',
	type: 'sale',
	name: 'Puja Sale',
	title: { en: 'Puja Sale', bn: 'পুজোর সেল' },
	message: { en: 'Up to 30% off', bn: '৩০% পর্যন্ত ছাড়' },
	startsAt: '2027-09-20T04:30:00.000Z',
	endsAt: '2027-09-27T18:29:00.000Z',
	sale: { categories: [{ categoryId: 'cat_saree', rule: rule('percent', 20), exceptions: [] }], products: [] },
	linkHref: null,
	showCountdown: true,
	showPopup: true,
	popupAssetId: null,
	nowLiveDays: 3,
	launch: { categoryIds: [], productIds: [], heldProductIds: [] },
	status: 'draft',
	publishedAt: null,
	startedAt: null,
	endedAt: null,
	cancelledAt: null,
	messageSentAt: null,
	launchReport: null,
	saleRecord: null,
	...partial,
});

describe('applySaleRule', () => {
	it('rounds a percent down to whole rupees', () => {
		expect(applySaleRule(rule('percent', 20), 4_999, 'A')).toBe(3_999);
	});

	it('takes a flat amount off', () => {
		expect(applySaleRule(rule('amount', 500), 4_999, 'A')).toBe(4_499);
	});

	it('uses a per-SKU fixed price before the rule value', () => {
		const fixed = rule('fixed', 3_000, { B: 4_200 });
		expect(applySaleRule(fixed, 4_999, 'A')).toBe(3_000);
		expect(applySaleRule(fixed, 5_999, 'B')).toBe(4_200);
	});

	it('refuses ₹ 0, a price above normal, and more off than the price', () => {
		expect(applySaleRule(rule('fixed', 0), 4_999, 'A')).toBeNull();
		expect(applySaleRule(rule('fixed', 6_000), 4_999, 'A')).toBeNull();
		expect(applySaleRule(rule('amount', 5_000), 4_999, 'A')).toBeNull();
		expect(applySaleRule(rule('percent', 100), 4_999, 'A')).toBeNull();
	});

	it('treats an unchanged price as no sale', () => {
		expect(applySaleRule(rule('fixed', 4_999), 4_999, 'A')).toBeNull();
	});
});

describe('resolveSaleRule', () => {
	const setup: SaleSetup = {
		categories: [
			{
				categoryId: 'cat_saree',
				rule: rule('percent', 20),
				exceptions: [
					{ productId: 'p_held', mode: 'held', rule: null },
					{ productId: 'p_own', mode: 'own', rule: rule('amount', 1_000) },
				],
			},
			{ categoryId: 'cat_silk', rule: rule('percent', 30), exceptions: [] },
		],
		products: [{ productId: 'p_single', rule: rule('fixed', 999) }],
	};
	const inBoth = (id: string) => id === 'cat_saree' || id === 'cat_silk';

	it('puts a product rule first', () => {
		expect(resolveSaleRule(setup, 'p_single', inBoth)?.source).toBe('product');
	});

	it('puts an exception before the category rule', () => {
		const found = resolveSaleRule(setup, 'p_own', inBoth);
		expect(found?.source).toBe('exception');
		expect(salePriceINR(found?.candidates ?? [], 5_000, 'A')).toBe(4_000);
	});

	it('keeps a held product out even when another category would discount it', () => {
		expect(resolveSaleRule(setup, 'p_held', inBoth)).toEqual({ source: 'held', candidates: [] });
	});

	it('gives the lower price when two categories disagree', () => {
		const found = resolveSaleRule(setup, 'p_any', inBoth);
		expect(found?.candidates).toHaveLength(2);
		expect(salePriceINR(found?.candidates ?? [], 10_000, 'A')).toBe(7_000);
	});

	it('leaves a product outside the sale alone', () => {
		expect(resolveSaleRule(setup, 'p_other', () => false)).toBeNull();
	});
});

describe('rule checks', () => {
	it('refuses impossible rules on Save', () => {
		expect(saleRuleProblem(rule('percent', 0))).toBe('percent_out_of_range');
		expect(saleRuleProblem(rule('amount', 10.5))).toBe('amount_not_whole');
		expect(saleRuleProblem(rule('fixed', 0))).toBe('fixed_zero');
		expect(saleRuleProblem(rule('percent', 25))).toBeNull();
	});

	it('warns above 60% off', () => {
		expect(saleWarning(1_000, 390)).toBe(true);
		expect(saleWarning(1_000, 400)).toBe(false);
		expect(saleWarning(1_000, null)).toBe(false);
	});

	it('refuses an end before the start on Save', () => {
		const body = { ...sale(), endsAt: '2027-09-19T00:00:00.000Z' };
		expect(shopEventSaveProblems('sale', body).map((row) => row.code)).toContain('end_before_start');
	});
});

describe('publish checks', () => {
	const now = new Date('2027-09-01T00:00:00.000Z');

	it('passes a complete sale', () => {
		expect(shopEventPublishProblems(sale(), ['en', 'bn'], now)).toEqual([]);
	});

	it('needs both languages, a future start, an end and an item', () => {
		const codes = shopEventPublishProblems(
			sale({
				title: { en: 'Puja Sale' },
				startsAt: '2027-08-01T00:00:00.000Z',
				endsAt: null,
				sale: { categories: [], products: [] },
			}),
			['en', 'bn'],
			now,
		).map((row) => `${row.code}:${row.target}`);
		expect(codes).toEqual(['missing_text:title:bn', 'start_passed:startsAt', 'missing_end:endsAt', 'no_items:']);
	});

	it('refuses an event already published', () => {
		expect(shopEventPublishProblems(sale({ status: 'scheduled' }), ['en'], now)[0]?.code).toBe('not_draft');
	});
});

describe('the clock', () => {
	it('starts a scheduled event at its start and ends a live sale at its end', () => {
		const start = new Date('2027-09-20T04:30:00.000Z');
		expect(dueTransition(sale({ status: 'scheduled' }), new Date(start.getTime() - 1))).toBeNull();
		expect(dueTransition(sale({ status: 'scheduled' }), start)).toBe('start');
		expect(dueTransition(sale({ status: 'live' }), new Date('2027-09-27T18:29:00.000Z'))).toBe('end');
		expect(dueTransition(sale({ status: 'draft' }), new Date('2030-01-01'))).toBeNull();
	});

	it('runs sale prices by the clock, even before the status write', () => {
		const during = new Date('2027-09-21T00:00:00.000Z');
		expect(saleRunsAt(sale({ status: 'scheduled' }), during)).toBe(true);
		expect(saleRunsAt(sale({ status: 'draft' }), during)).toBe(false);
		expect(saleRunsAt(sale({ status: 'live' }), new Date('2027-09-27T18:29:00.000Z'))).toBe(false);
	});

	it('finds overlapping windows', () => {
		const a = { startsAt: '2027-09-01T00:00:00Z', endsAt: '2027-09-10T00:00:00Z' };
		expect(windowsOverlap(a, { startsAt: '2027-09-09T00:00:00Z', endsAt: '2027-09-12T00:00:00Z' })).toBe(true);
		expect(windowsOverlap(a, { startsAt: '2027-09-10T00:00:00Z', endsAt: null })).toBe(false);
	});
});

describe('publicShopEvent', () => {
	it('counts down to the start, then to the end of a sale', () => {
		const before = publicShopEvent(sale({ status: 'scheduled' }), 'bn', new Date('2027-09-01'), null);
		expect(before).toMatchObject({
			phase: 'upcoming',
			countdownTo: '2027-09-20T04:30:00.000Z',
			title: 'পুজোর সেল',
		});
		const during = publicShopEvent(sale({ status: 'live' }), 'en', new Date('2027-09-21'), null);
		expect(during).toMatchObject({ phase: 'running', countdownTo: '2027-09-27T18:29:00.000Z' });
		expect(publicShopEvent(sale({ status: 'live' }), 'en', new Date('2027-09-28'), null)).toBeNull();
	});

	it('keeps a launch popup 60 days from the start, not from publishing', () => {
		const launch = sale({
			type: 'launch',
			status: 'live',
			endsAt: null,
			startsAt: '2027-09-01T04:30:00.000Z',
			publishedAt: '2027-08-01T00:00:00.000Z',
		});
		const day59 = publicShopEvent(launch, 'en', new Date('2027-10-30T00:00:00.000Z'), null);
		expect(day59).toMatchObject({ phase: 'launched', countdownTo: null, popupUntil: '2027-10-31T04:30:00.000Z' });
		expect(publicShopEvent(launch, 'en', new Date('2027-10-31T05:00:00.000Z'), null)).toBeNull();
	});

	it('shows nothing for drafts and cancelled events', () => {
		expect(publicShopEvent(sale(), 'en', new Date('2027-09-01'), null)).toBeNull();
		expect(publicShopEvent(sale({ status: 'cancelled' }), 'en', new Date('2027-09-01'), null)).toBeNull();
	});
});
