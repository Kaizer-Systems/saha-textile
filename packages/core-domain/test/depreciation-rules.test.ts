import { describe, expect, it } from 'vitest';

import {
	ASSET_CATEGORIES,
	type AssetForDepreciation,
	RESIDUAL_PERCENT,
	monthlyDepreciation,
	taxDepreciation,
	wdvRate,
} from '../src/assets/depreciation-rules';

/**
 * Fixed assets (accounts brief R1–R4), checked against the law: Schedule II useful lives with a residual of up to 5%,
 * its written-down-value rate, depreciation from the month put to use through the month of disposal, and the Income
 * Tax Act's block rates at half for an asset used under 180 days in its first year (s.32(1), second proviso).
 */

describe('the presets', () => {
	it('offers eight categories', () => {
		expect(ASSET_CATEGORIES.map((c) => c.key)).toEqual([
			'furniture',
			'computers',
			'office_equipment',
			'electrical',
			'plant',
			'vehicles',
			'buildings',
			'software',
		]);
	});

	it('gives Schedule II lives and the tax block rates where the law is plain', () => {
		const preset = (key: string) => ASSET_CATEGORIES.find((c) => c.key === key);
		expect(preset('furniture')).toEqual({ key: 'furniture', lifeYears: 10, taxRatePct: 10 });
		expect(preset('computers')).toEqual({ key: 'computers', lifeYears: 3, taxRatePct: 40 });
		expect(preset('office_equipment')).toEqual({ key: 'office_equipment', lifeYears: 5, taxRatePct: 15 });
		expect(preset('electrical')).toEqual({ key: 'electrical', lifeYears: 10, taxRatePct: 10 });
		expect(preset('plant')).toEqual({ key: 'plant', lifeYears: 15, taxRatePct: 15 });
		for (const category of ASSET_CATEGORIES) {
			expect(category.lifeYears).toBeGreaterThan(0);
			expect(category.taxRatePct).toBeGreaterThan(0);
		}
	});

	it('keeps a residual of 5% of cost', () => {
		expect(RESIDUAL_PERCENT).toBe(5);
	});
});

describe('the written-down-value rate', () => {
	it('brings cost to residual over the life (Schedule II)', () => {
		const rate = wdvRate(100_000, 5_000, 5);
		expect(rate).toBeCloseTo(0.4507, 4);
		// Applied five times, cost comes down to the residual.
		expect(100_000 * (1 - rate) ** 5).toBeCloseTo(5_000, 6);
	});

	it('treats a residual of nothing as one paisa, so the rate stays below 100%', () => {
		const rate = wdvRate(100_000, 0, 5);
		expect(rate).toBe(1 - (1 / 100_000) ** (1 / 5));
		expect(rate).toBeLessThan(1);
	});

	it('is nothing without a cost or a life', () => {
		expect(wdvRate(0, 0, 5)).toBe(0);
		expect(wdvRate(-1, 0, 5)).toBe(0);
		expect(wdvRate(100_000, 5_000, 0)).toBe(0);
		expect(wdvRate(100_000, 5_000, -1)).toBe(0);
	});
});

describe('a month’s book depreciation', () => {
	// The approved R3 picture: ₹3,50,000 with a ₹17,500 residual over ten years, put to use on 15 August 2026.
	const asset = (over: Partial<AssetForDepreciation> = {}): AssetForDepreciation => ({
		costPaise: 35_000_000,
		residualPaise: 1_750_000,
		putToUseOn: '2026-08-15',
		method: 'slm',
		lifeMonths: 120,
		accumulatedPaise: 0,
		disposedOn: null,
		...over,
	});

	it('takes (cost − residual) ÷ months by straight line: ₹2,770.83 a month', () => {
		expect(monthlyDepreciation(asset(), '2026-08')).toBe(277_083);
		expect(monthlyDepreciation(asset({ accumulatedPaise: 2_770_830 }), '2027-06')).toBe(277_083);
	});

	it('takes nothing before the month put to use', () => {
		expect(monthlyDepreciation(asset(), '2026-07')).toBe(0);
		expect(monthlyDepreciation(asset(), '2025-12')).toBe(0);
	});

	it('takes the month of disposal, then nothing', () => {
		const sold = asset({ disposedOn: '2027-03-10' });
		expect(monthlyDepreciation(sold, '2027-03')).toBe(277_083);
		expect(monthlyDepreciation(sold, '2027-04')).toBe(0);
	});

	it('takes only what is left above the residual in the last month, then nothing', () => {
		// 119 months taken: 277,083 × 119 = 32,972,877 paise; 277,123 paise left, more than a month's share.
		const nearlyDone = asset({ accumulatedPaise: 277_083 * 119 });
		expect(monthlyDepreciation(nearlyDone, '2036-07')).toBe(277_083);
		const lastBit = asset({ accumulatedPaise: 33_250_000 - 1_000 });
		expect(monthlyDepreciation(lastBit, '2036-08')).toBe(1_000);
		expect(monthlyDepreciation(asset({ accumulatedPaise: 33_250_000 }), '2036-09')).toBe(0);
		expect(monthlyDepreciation(asset({ accumulatedPaise: 33_250_001 }), '2036-09')).toBe(0);
	});

	it('takes nothing for an asset with no life', () => {
		expect(monthlyDepreciation(asset({ lifeMonths: 0 }), '2026-09')).toBe(0);
	});

	it('takes a twelfth of the year’s rate on cost less what is taken, by written-down value', () => {
		const wdv = asset({ method: 'wdv' });
		const rate = wdvRate(35_000_000, 1_750_000, 10);
		expect(monthlyDepreciation(wdv, '2026-08')).toBe(Math.round((35_000_000 * rate) / 12));
		const later = asset({ method: 'wdv', accumulatedPaise: 10_000_000 });
		expect(monthlyDepreciation(later, '2028-01')).toBe(Math.round((25_000_000 * rate) / 12));
		// Less as the book value falls.
		expect(monthlyDepreciation(later, '2028-01')).toBeLessThan(monthlyDepreciation(wdv, '2026-08'));
	});
});

describe('tax depreciation for a year', () => {
	it('takes the block rate on the opening written-down value', () => {
		expect(taxDepreciation(10_000_000, 15, '2024-06-01', '2026-27')).toBe(1_500_000);
		expect(taxDepreciation(333, 15, '2024-06-01', '2026-27')).toBe(50);
	});

	it('takes half the rate for an asset first used on or after 4 October of the year: under 180 days', () => {
		expect(taxDepreciation(10_000_000, 40, '2026-10-04', '2026-27')).toBe(2_000_000);
		expect(taxDepreciation(10_000_000, 40, '2027-03-31', '2026-27')).toBe(2_000_000);
		expect(taxDepreciation(10_000_000, 40, '2027-01-15', '2026-27')).toBe(2_000_000);
	});

	it('takes the full rate for an asset first used before 4 October: 180 days or more', () => {
		expect(taxDepreciation(10_000_000, 40, '2026-10-03', '2026-27')).toBe(4_000_000);
		expect(taxDepreciation(10_000_000, 40, '2026-04-01', '2026-27')).toBe(4_000_000);
	});

	it('takes the full rate in later years, whatever day the asset was first used', () => {
		expect(taxDepreciation(10_000_000, 40, '2025-11-20', '2026-27')).toBe(4_000_000);
		expect(taxDepreciation(10_000_000, 40, '2026-03-31', '2026-27')).toBe(4_000_000);
	});

	it('counts the 180 days to 31 March, so a year with 29 February moves the line a day', () => {
		// FY 2027-28 ends after 29 February 2028: from 4 October it is exactly 180 days, the full rate.
		expect(taxDepreciation(10_000_000, 40, '2027-10-04', '2027-28')).toBe(4_000_000);
		expect(taxDepreciation(10_000_000, 40, '2027-10-05', '2027-28')).toBe(2_000_000);
		expect(taxDepreciation(10_000_000, 40, '2028-03-31', '2027-28')).toBe(2_000_000);
	});
});

describe('the corrected presets', () => {
	it('gives a car 8 years and a shop or office building 60 (Schedule II), and software the computers’ 40% (Income Tax)', () => {
		const preset = (key: string) => ASSET_CATEGORIES.find((c) => c.key === key);
		expect(preset('vehicles')).toEqual({ key: 'vehicles', lifeYears: 8, taxRatePct: 15 });
		expect(preset('buildings')).toEqual({ key: 'buildings', lifeYears: 60, taxRatePct: 10 });
		expect(preset('software')).toEqual({ key: 'software', lifeYears: 6, taxRatePct: 40 });
	});
});
