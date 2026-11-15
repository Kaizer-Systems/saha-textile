const UNITS = ['byte', 'kilobyte', 'megabyte', 'gigabyte'] as const;

/**
 * A file's size the way the shopper's language writes it: “18.6 MB”, “240 kB”. Steps of 1024, as
 * the admin's storage box counts, and the browser's own unit names, so nothing is hand-written.
 */
export function fileSizeLabel(bytes: number, intlLocale: string): string {
	let value = Math.max(0, bytes);
	let unit = 0;
	while (value >= 1024 && unit < UNITS.length - 1) {
		value /= 1024;
		unit += 1;
	}
	return new Intl.NumberFormat(intlLocale, {
		style: 'unit',
		unit: UNITS[unit],
		unitDisplay: 'short',
		maximumFractionDigits: unit === 0 ? 0 : 1,
	}).format(value);
}
