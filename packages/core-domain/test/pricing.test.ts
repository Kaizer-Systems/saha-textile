import { describe, expect, it } from 'vitest';

import { applyDiscountINR, convertFromINR, discountAmountINR, paypalGrossUp, roundMoney } from '../src/index';

describe('roundMoney', () => {
	it('rounds to 2 decimals by default', () => {
		expect(roundMoney(10.005)).toBe(10.01);
		expect(roundMoney(2.345, 2)).toBe(2.35);
	});
});

describe('convertFromINR', () => {
	it('multiplies by rateFromINR', () => {
		expect(convertFromINR(1000, 0.012)).toBeCloseTo(12);
	});
	it('rejects non-positive rate', () => {
		expect(() => convertFromINR(100, 0)).toThrow();
	});
});

describe('paypalGrossUp', () => {
	it('grosses up so the net is preserved after fees', () => {
		const net = 100;
		const pct = 0.044;
		const fixed = 0.3;
		const gross = paypalGrossUp(net, pct, fixed);
		// Reverse the fee math: gross - (gross*pct + fixed) === net
		expect(roundMoney(gross - (gross * pct + fixed))).toBe(net);
	});
	it('rejects pct >= 1', () => {
		expect(() => paypalGrossUp(100, 1, 0)).toThrow();
	});
});

describe('discounts', () => {
	it('computes percentage discount on INR', () => {
		expect(discountAmountINR(2000, { type: 'percentage', value: 25 })).toBe(500);
		expect(applyDiscountINR(2000, { type: 'percentage', value: 25 })).toBe(1500);
	});
	it('caps fixed discount at the price', () => {
		expect(discountAmountINR(300, { type: 'fixed', value: 500 })).toBe(300);
		expect(applyDiscountINR(300, { type: 'fixed', value: 500 })).toBe(0);
	});
	it('caps percentage at 100', () => {
		expect(discountAmountINR(1000, { type: 'percentage', value: 150 })).toBe(1000);
	});
});
