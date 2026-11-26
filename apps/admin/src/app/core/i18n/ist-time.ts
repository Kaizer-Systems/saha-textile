/**
 * Event times in the admin are India time only (owner, 2026-11-09). A date-and-time box normally
 * follows the computer's own zone; these read and write it as IST whatever that zone is. India
 * keeps +05:30 all year, so the conversion is exact arithmetic.
 */

const IST_OFFSET_MINUTES = 330;

/** `2027-09-27T23:59` typed as India time → the UTC instant. Null when it isn't a valid time. */
export function istInputToUtc(local: string): string | null {
	const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local.trim());
	if (!match) return null;
	const [, y, mo, d, h, mi] = match.map(Number) as [number, number, number, number, number, number];
	const utc = Date.UTC(y, mo - 1, d, h, mi) - IST_OFFSET_MINUTES * 60_000;
	const check = new Date(utc + IST_OFFSET_MINUTES * 60_000);
	if (check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d || h > 23 || mi > 59) return null;
	return new Date(utc).toISOString();
}

/** A UTC instant → `2027-09-27T23:59` in India time, for a date-and-time input. */
export function utcToIstInput(iso: string): string {
	const shifted = new Date(new Date(iso).getTime() + IST_OFFSET_MINUTES * 60_000);
	const pad = (value: number) => String(value).padStart(2, '0');
	return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}T${pad(
		shifted.getUTCHours(),
	)}:${pad(shifted.getUTCMinutes())}`;
}
