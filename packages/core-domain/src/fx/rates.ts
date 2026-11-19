import type { Currency, FxSettings, LAUNCH_CURRENCY_SYMBOLS as ContractSymbols } from '@saha-textile/contracts';

/**
 * The launch currencies (owner FX6) and the symbols the brief writes for them. The contracts hold
 * the same list for the API; core keeps its own copy because it loads nothing from other packages
 * at runtime (G-CORE-CONTRACTS). The type check below fails the build if the two lists of codes ever differ.
 */
export const FX_LAUNCH_SYMBOLS = {
	USD: 'US$',
	GBP: '£',
	EUR: '€',
	CAD: 'C$',
	AUD: 'A$',
	SGD: 'S$',
	NZD: 'NZ$',
} as const satisfies typeof ContractSymbols;
type LaunchCode = keyof typeof FX_LAUNCH_SYMBOLS;
const LAUNCH_CURRENCIES = Object.keys(FX_LAUNCH_SYMBOLS) as LaunchCode[];

/**
 * Exchange rates (shipping rules brief fx01; owner decisions DEC-PAYPAL-FX and FX6). Staff read and
 * type a rate as rupees per unit (US$ 1 = ₹88.42); it is stored as the multiplier from rupees
 * (`rateFromINR`, 1 / 88.42) that pricing uses. Rates never learn from payments.
 */

/** Rupees per one unit, as the admin shows it (4 decimals kept). */
export function inrPerUnitOf(rateFromINR: number): number {
	if (!(rateFromINR > 0)) throw new RangeError('rateFromINR must be positive');
	return Math.round((1 / rateFromINR) * 10_000) / 10_000;
}

/** The stored multiplier from a typed "₹ per unit". */
export function rateFromInrPerUnit(inrPerUnit: number): number {
	if (!(inrPerUnit > 0)) throw new RangeError('inrPerUnit must be positive');
	return 1 / inrPerUnit;
}

const IST_OFFSET_MINUTES = 5 * 60 + 30;

/** The India date (`YYYY-MM-DD`) and minutes since India midnight of an instant. */
export function indiaClock(at: Date): { date: string; minutes: number } {
	const shifted = new Date(at.getTime() + IST_OFFSET_MINUTES * 60_000);
	return {
		date: shifted.toISOString().slice(0, 10),
		minutes: shifted.getUTCHours() * 60 + shifted.getUTCMinutes(),
	};
}

/**
 * Whether the daily fetch should run now: switched on, the set India time has passed today, and it
 * has not run since that time today. Checked every few minutes, so a missed time catches up.
 */
export function isDailyFetchDue(settings: Pick<FxSettings, 'dailyFetch'>, now: Date): boolean {
	const { enabled, time, lastRunAt } = settings.dailyFetch;
	if (!enabled) return false;
	const [hours, minutes] = time.split(':').map(Number) as [number, number];
	const at = hours * 60 + minutes;
	const today = indiaClock(now);
	if (today.minutes < at) return false;
	if (!lastRunAt) return true;
	const last = indiaClock(new Date(lastRunAt));
	return last.date < today.date || (last.date === today.date && last.minutes < at);
}

/**
 * The currencies after a fetch: each launch currency and each stored foreign currency the provider
 * answered for gets the new rate, marked as set by the daily fetch. A launch currency with no row
 * yet is created switched on (FX6). Rupees are never touched.
 */
export function applyFetchedRates(
	current: readonly Currency[],
	rates: Readonly<Record<string, number>>,
	now: Date,
	homeCurrency = 'INR',
): Currency[] {
	const at = now.toISOString();
	const byCode = new Map(current.map((c) => [c.code, c]));
	const codes = new Set<string>([...LAUNCH_CURRENCIES, ...current.map((c) => c.code)]);
	const updated: Currency[] = [];
	for (const code of codes) {
		if (code === homeCurrency) continue;
		const rate = rates[code];
		if (!(typeof rate === 'number' && rate > 0 && Number.isFinite(rate))) continue;
		const existing = byCode.get(code);
		updated.push({
			code,
			symbol: existing?.symbol ?? FX_LAUNCH_SYMBOLS[code as LaunchCode] ?? code,
			enabled: existing?.enabled ?? true,
			rateFromINR: rate,
			paypalActive: existing?.paypalActive ?? true,
			paypalPct: existing?.paypalPct ?? 0,
			paypalFixed: existing?.paypalFixed ?? 0,
			rateSetBy: 'fetch',
			rateSetById: null,
			rateSetAt: at,
		});
	}
	return updated;
}
