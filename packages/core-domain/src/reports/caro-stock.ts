/**
 * CARO 2020 clause 3(ii)(a) (accounts brief R1): physical verification of stock, with discrepancies of 10% or more in
 * aggregate for a class of inventory reported. Pure: each posted count's lines grouped by class (pieces, and fabric
 * by the metre, kept in tenths: they never add up together), book quantity against counted, the net difference, its
 * share of the book quantity, and whether it reaches the 10% line.
 */

export const CARO_LINE_PERCENT = 10;

export interface CaroCountLine {
	soldBy: 'piece' | 'metre';
	expected: number | null;
	counted: number | null;
	valueINR: number | null;
}

export interface CaroClassRow {
	soldBy: 'piece' | 'metre';
	bookQty: number;
	countedQty: number;
	differenceQty: number;
	/** The net difference's share of the book quantity, % to one decimal; null when the book quantity is nothing. */
	percent: number | null;
	differenceINR: number;
	reportable: boolean;
}

/** One count's classes, each with its aggregate discrepancy. */
export function caroClasses(lines: readonly CaroCountLine[]): CaroClassRow[] {
	const out: CaroClassRow[] = [];
	for (const soldBy of ['piece', 'metre'] as const) {
		const mine = lines.filter((l) => l.soldBy === soldBy && l.expected !== null && l.counted !== null);
		if (!mine.length) continue;
		const bookQty = mine.reduce((sum, l) => sum + (l.expected as number), 0);
		const countedQty = mine.reduce((sum, l) => sum + (l.counted as number), 0);
		const differenceQty = countedQty - bookQty;
		// Compared unrounded: 9.96% rounds to 10.0% for the screen but is below the 10% line.
		const share = bookQty ? (Math.abs(differenceQty) / bookQty) * 100 : null;
		const percent = share === null ? null : Math.round(share * 10) / 10;
		out.push({
			soldBy,
			bookQty,
			countedQty,
			differenceQty,
			percent,
			differenceINR: Math.round(mine.reduce((sum, l) => sum + (l.valueINR ?? 0), 0) * 100) / 100,
			reportable: share === null ? differenceQty !== 0 : share >= CARO_LINE_PERCENT,
		});
	}
	return out;
}
