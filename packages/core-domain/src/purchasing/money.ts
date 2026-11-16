/**
 * Money and quantity helpers for purchases and stock. Arithmetic runs in whole paise so a bill
 * of 500 lines adds up exactly; rupees with two decimals are what goes in and out.
 */

/** Rupees → whole paise, rounding half away from zero (₹0.005 → 1 paisa). */
export function toPaise(rupees: number): number {
	const scaled = Math.round(Math.abs(rupees) * 100 + 1e-9);
	return rupees < 0 ? -scaled : scaled;
}

/** Whole paise → rupees with two decimals. */
export function fromPaise(paise: number): number {
	return Math.round(paise) / 100;
}

/** Rounds a paise amount that came out of a division or a rate, half away from zero. */
export function roundPaise(value: number): number {
	const rounded = Math.round(Math.abs(value) + 1e-9);
	return value < 0 ? -rounded : rounded;
}

/** A unit cost kept to four decimals of a rupee, so FIFO values add up to the paisa. */
export function roundUnitCost(rupees: number): number {
	return Math.round(rupees * 10_000 + (rupees >= 0 ? 1e-9 : -1e-9)) / 10_000;
}

/** Indian-grouped rupees for messages: ₹1,83,750 or ₹9,295.61. */
export function formatRupees(rupees: number): string {
	const whole = Number.isInteger(Math.round(rupees * 100) / 100) && Math.round(rupees * 100) % 100 === 0;
	return `₹${rupees.toLocaleString('en-IN', {
		minimumFractionDigits: whole ? 0 : 2,
		maximumFractionDigits: 2,
	})}`;
}

export type SoldBy = 'piece' | 'metre';

/**
 * A stock quantity in words: pieces as they are, metres from tenths ("42.5 m"). Metre products
 * keep stock in tenths of a metre (P11), so 25 means 2.5 m.
 */
export function formatQuantity(units: number, soldBy: SoldBy): string {
	if (soldBy === 'metre') return `${(units / 10).toFixed(1)} m`;
	return String(units);
}

/** Pieces, or "pieces and metres" when a document mixes both. */
export function describeUnits(lines: ReadonlyArray<{ units: number; soldBy: SoldBy }>): string {
	const pieces = lines.filter((line) => line.soldBy === 'piece').reduce((sum, line) => sum + line.units, 0);
	const tenths = lines.filter((line) => line.soldBy === 'metre').reduce((sum, line) => sum + line.units, 0);
	const parts: string[] = [];
	if (pieces || !tenths) parts.push(`${pieces} ${pieces === 1 ? 'piece' : 'pieces'}`);
	if (tenths) parts.push(formatQuantity(tenths, 'metre'));
	return parts.join(' and ');
}
