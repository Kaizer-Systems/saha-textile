/**
 * Indian financial years and document numbers (P7; CA: consecutive, unique in the financial year,
 * at most 16 characters, reset on 1 April, a cancelled number never reused).
 */

const IST_OFFSET_MS = 330 * 60_000;

/** The India calendar day of an instant, `YYYY-MM-DD`. */
export function istDay(at: Date | string): string {
	const shifted = new Date(new Date(at).getTime() + IST_OFFSET_MS);
	return shifted.toISOString().slice(0, 10);
}

/** `2026-27` for any day from 1 April 2026 to 31 March 2027. */
export function fiscalYearOf(day: string): string {
	const [yearText, monthText] = day.split('-');
	const year = Number(yearText);
	const month = Number(monthText);
	const start = month >= 4 ? year : year - 1;
	return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

/** The short form printed in numbers: `26-27`. */
export function shortFiscalYear(fiscalYear: string): string {
	const [start, end] = fiscalYear.split('-');
	// split always gives a first part, even for text with no dash.
	return `${(start as string).slice(2)}-${end ?? ''}`;
}

/**
 * Fills a number format: `{fy}` → `26-27`, `{seqN}` → the sequence padded to N digits.
 * `PE/{fy}/{seq6}` with sequence 14 in 2026-27 → `PE/26-27/000014`.
 */
export function formatDocumentNumber(format: string, fiscalYear: string, sequence: number): string {
	return format
		.replace('{fy}', shortFiscalYear(fiscalYear))
		.replace(/\{seq(\d)\}/, (_, digits: string) => String(sequence).padStart(Number(digits), '0'));
}

/** Rule 46: a GST document number is at most 16 characters. */
export const MAX_DOCUMENT_NUMBER_LENGTH = 16;

/** Whether a format can ever produce a number over 16 characters (checked with a 6-digit year). */
export function numberFormatProblem(format: string): 'missing_sequence' | 'too_long' | null {
	if (!/\{seq\d\}/.test(format)) return 'missing_sequence';
	if (formatDocumentNumber(format, '2099-00', 999_999).length > MAX_DOCUMENT_NUMBER_LENGTH) return 'too_long';
	return null;
}

/** Adds whole days to a calendar day. */
export function addDays(day: string, days: number): string {
	const date = new Date(`${day}T00:00:00Z`);
	date.setUTCDate(date.getUTCDate() + days);
	return date.toISOString().slice(0, 10);
}

/** Whole days from `from` to `to` (negative when `to` is earlier). */
export function daysBetween(from: string, to: string): number {
	return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}
