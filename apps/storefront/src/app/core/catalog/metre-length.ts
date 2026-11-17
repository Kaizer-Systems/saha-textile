/**
 * Fabric sold by the metre in the shop (shop brief M01–M10). Every length is whole tenths of a
 * metre, as the server stores it; these helpers turn what a shopper taps or types into tenths and
 * say why a length cannot be bought. The server checks the same rules again.
 */

export interface MetreRule {
	shortestCutTenths: number;
	/** What − and + change the length by (M1: 0.5 m). */
	stepTenths: number;
	quickLengths: Array<{ tenths: number; label: string }>;
	widthInches: number | null;
}

/** "2.5 m" (English digits in every language; the unit is the reader's). */
export function lengthText(tenths: number, unit: string): string {
	return `${(tenths / 10).toFixed(1)} ${unit}`;
}

/**
 * A typed length → tenths, snapped half up to 0.1 m (M03: 2.55 m becomes 2.6 m). "2,5" reads as
 * 2.5 and a trailing "m" is ignored. Null when nothing above 0 can be read.
 */
export function readLength(text: string): { tenths: number; snapped: boolean } | null {
	const cleaned = text
		.trim()
		.toLowerCase()
		.replace(/\s*(m|মি\.?|metres?|meters?)$/, '')
		.replace(',', '.');
	if (!/^\d+(\.\d+)?$/.test(cleaned)) return null;
	const value = Number(cleaned);
	if (!(value > 0)) return null;
	const tenths = Math.round(value * 10 + 1e-9);
	if (tenths < 1) return null;
	return { tenths, snapped: Math.abs(value * 10 - tenths) > 1e-9 };
}

/** Why a length cannot be bought: under the shortest cut (M04), or more than is free to sell. */
export function lengthProblem(
	tenths: number,
	rule: Pick<MetreRule, 'shortestCutTenths'>,
	available: number | null,
): 'below_cut' | 'over_stock' | null {
	if (tenths < rule.shortestCutTenths) return 'below_cut';
	if (available !== null && tenths > available) return 'over_stock';
	return null;
}

/** − or + by the step, never under the shortest cut nor over what is free to sell. */
export function stepLength(tenths: number, direction: 1 | -1, rule: MetreRule, available: number | null): number {
	const next = tenths + direction * rule.stepTenths;
	const floor = rule.shortestCutTenths;
	const ceiling = available ?? Number.POSITIVE_INFINITY;
	if (direction < 0) return Math.max(floor, next);
	return Math.min(Math.max(floor, next), Math.max(floor, ceiling));
}

/** Length × price per metre, to the paisa, as the server works it out. */
export function metreTotal(pricePerMetre: number, tenths: number): number {
	return Math.round((Math.round(pricePerMetre * 100) * tenths) / 10) / 100;
}
