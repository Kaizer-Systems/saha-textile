/**
 * Fixed assets (accounts brief R1–R4). Pure: the presets per category (Companies Act Schedule II useful lives with a 5%
 * residual, Income Tax Act block rates), the book depreciation for a month (straight line or written down value, from
 * the month the asset is put to use, never below its residual value), and tax depreciation for a financial year (half
 * the block rate when used under 180 days in its first year). Money is paise.
 */

export interface AssetCategoryPreset {
	key: string;
	/** Schedule II useful life in years. */
	lifeYears: number;
	/** Income Tax Act block rate, % a year on written down value. */
	taxRatePct: number;
}

export const ASSET_CATEGORIES: readonly AssetCategoryPreset[] = [
	{ key: 'furniture', lifeYears: 10, taxRatePct: 10 },
	{ key: 'computers', lifeYears: 3, taxRatePct: 40 },
	{ key: 'office_equipment', lifeYears: 5, taxRatePct: 15 },
	{ key: 'electrical', lifeYears: 10, taxRatePct: 10 },
	{ key: 'plant', lifeYears: 15, taxRatePct: 15 },
	{ key: 'vehicles', lifeYears: 10, taxRatePct: 15 },
	{ key: 'buildings', lifeYears: 30, taxRatePct: 10 },
	{ key: 'software', lifeYears: 6, taxRatePct: 25 },
];

/** Schedule II: residual value up to 5% of cost. */
export const RESIDUAL_PERCENT = 5;

export interface AssetForDepreciation {
	costPaise: number;
	residualPaise: number;
	putToUseOn: string;
	method: 'slm' | 'wdv';
	lifeMonths: number;
	/** Depreciation already taken in the books (paise). */
	accumulatedPaise: number;
	disposedOn: string | null;
}

const monthIndex = (month: string) => Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1;

/** The written down value rate a year that brings cost to residual over the life (Schedule II note 2). */
export function wdvRate(costPaise: number, residualPaise: number, lifeYears: number): number {
	if (costPaise <= 0 || lifeYears <= 0) return 0;
	const floor = Math.max(residualPaise, 1);
	return 1 - (floor / costPaise) ** (1 / lifeYears);
}

/**
 * The book depreciation for `month` (YYYY-MM): nothing before the month put to use, after the month disposed, or once
 * the book value reaches residual; the last month takes only what is left above residual.
 */
export function monthlyDepreciation(asset: AssetForDepreciation, month: string): number {
	const started = monthIndex(asset.putToUseOn.slice(0, 7));
	const now = monthIndex(month);
	if (now < started) return 0;
	if (asset.disposedOn && now > monthIndex(asset.disposedOn.slice(0, 7))) return 0;
	const left = asset.costPaise - asset.residualPaise - asset.accumulatedPaise;
	if (left <= 0 || asset.lifeMonths <= 0) return 0;
	const amount =
		asset.method === 'slm'
			? (asset.costPaise - asset.residualPaise) / asset.lifeMonths
			: ((asset.costPaise - asset.accumulatedPaise) *
					wdvRate(asset.costPaise, asset.residualPaise, asset.lifeMonths / 12)) /
				12;
	return Math.min(Math.round(amount), left);
}

/**
 * Tax depreciation for a financial year (`2026-27`) on the block's written down value at its start: the block rate,
 * or half of it when the asset was first used in that year for less than 180 days (used on or after 4 October).
 */
export function taxDepreciation(openingWdvPaise: number, taxRatePct: number, putToUseOn: string, year: string): number {
	const start = Number(year.slice(0, 4));
	const firstYear = putToUseOn >= `${start}-04-01` && putToUseOn <= `${start + 1}-03-31`;
	const halfFrom = `${start}-10-04`;
	const rate = firstYear && putToUseOn >= halfFrom ? taxRatePct / 2 : taxRatePct;
	return Math.round((openingWdvPaise * rate) / 100);
}
