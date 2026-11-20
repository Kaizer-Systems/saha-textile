import { describe, expect, it } from 'vitest';

import { blankCoupon, couponWords } from './coupon-builder';
import { toCouponRow } from './coupon-list';

import type { CouponListRow } from '@saha-textile/contracts';

const t = (key: string, params?: object) => (params ? `${key}(${Object.values(params).join('|')})` : key);

describe('coupons list (cp01)', () => {
	it('draws what a coupon gives, its uses and status, and locks an ended one', () => {
		const row: CouponListRow = {
			id: 'cpn_1',
			code: 'WEDDING10',
			title: '<b>Wedding</b>',
			kind: 'percentOff',
			value: 10,
			capINR: 2_000,
			combines: true,
			enabled: true,
			usedCount: 42,
			totalUses: 500,
			validFrom: null,
			validUntil: null,
			appliesTo: 'Sarees · not sale items',
			expired: false,
		};
		const drawn = toCouponRow(row, t);
		expect(drawn.code).toContain('&lt;b&gt;Wedding&lt;/b&gt;');
		expect(drawn.gives).toBe('cpn_gives_percent(10)');
		expect(drawn.used).toBe('42 / 500');
		expect(drawn.valid).toBe('cpn_always');
		expect(drawn).toMatchObject({ status: 1, statusLabel: 'cpn_on', locked: false });
		expect(toCouponRow({ ...row, expired: true, totalUses: null }, t)).toMatchObject({
			used: '42 / —',
			statusLabel: 'cpn_ended',
			locked: true,
		});
	});
});

describe('coupon builder in plain words (cp02, OD4)', () => {
	it('starts as OD4 says: once per customer, sale pieces out, not combining, off', () => {
		expect(blankCoupon()).toMatchObject({
			usesPerCustomer: 1,
			includeSaleItems: false,
			combines: false,
			usableOnZonePrices: false,
			enabled: false,
		});
	});

	it('reads the coupon back line by line', () => {
		const words = couponWords(
			{
				...blankCoupon(),
				capINR: 2_000,
				scope: { kind: 'categories', categoryIds: ['cat_saree'], includeSubcategories: true },
				combines: true,
				totalUses: 500,
			},
			t,
			(id) => (id === 'cat_saree' ? 'Sarees' : id),
		);
		expect(words[0]).toBe('cpn_words_percent(10) cpn_words_cap(₹2,000)');
		expect(words[1]).toBe('cpn_words_categories_subs(Sarees)cpn_words_not_sale');
		expect(words).toContain('cpn_words_total(500)');
		expect(words).toContain('cpn_words_combines');
		expect(words.at(-1)).toBe('cpn_words_never_delivery');
		expect(couponWords({ ...blankCoupon(), kind: 'freeDelivery', value: 0 }, t)[0]).toBe('cpn_words_free_delivery');
	});
});
