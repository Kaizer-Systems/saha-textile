import type {
	DocumentNumberingSettings,
	NumberedDocumentType,
	NumberFormatProblem,
	OrderChildFormat,
	OrderNumberFormat,
	SeriesFormat,
} from '@saha-textile/contracts';

/**
 * `DocumentNumberingPolicy` (`DEC-NUMBERING`; table accepted 2026-11-20 except the order row).
 *
 * Pure: renders numbers from a format, checks formats when they are set, and gives the forms an SMS
 * and a search use. Counters live behind `NumberAllocatorPort` and are taken inside the posting
 * transaction, so drafts and failed saves never use one up. Numbers belong to the business and the
 * law; a message provider's limits are handled by the message form, never by the format.
 */

/** Rule 46. */
const GST_MAX = 16;
const GST_TYPES: ReadonlySet<NumberedDocumentType> = new Set([
	'taxInvoice',
	'creditNote',
	'debitNote',
	'receipt',
	'refundVoucher',
	'deliveryChallan',
	'paymentVoucher',
	'selfInvoice',
]);

export const isGstDocument = (type: NumberedDocumentType): boolean => GST_TYPES.has(type);

/** `26-27` from `2026-27`. */
const shortYear = (financialYear: string): string => {
	const [start, end] = financialYear.split('-');
	// split always gives a first part, even for text with no dash.
	return `${(start as string).slice(2)}-${end ?? ''}`;
};

/** The counter's key: one per series and financial year, or one for ever. */
export function seriesKey(
	type: NumberedDocumentType,
	format: SeriesFormat,
	financialYear: string,
): { series: string; period: string } {
	return { series: `doc:${type}`, period: format.reset === 'fy' ? financialYear : 'all' };
}

/** `TI/26-27/000123`. */
export function renderSeriesNumber(format: SeriesFormat, financialYear: string, sequence: number): string {
	const count = String(sequence).padStart(format.digits, '0');
	const parts = format.includeFinancialYear
		? [format.prefix, shortYear(financialYear), count]
		: [format.prefix, count];
	return parts.join(format.separator);
}

/** Letters and digits only, upper case: the form an SMS variable carries (MSG91 #alphanumeric#). */
export function messageForm(number: string): string {
	return number.replace(/[^0-9A-Za-z]/g, '').toUpperCase();
}

/** What search compares: the message form, so `ST-48213-90761` and `4821390761` both find the order. */
export function normalizeForSearch(text: string): string {
	return messageForm(text);
}

/**
 * Problems with a series format. GST documents must fit 16 characters at the largest count and a
 * long financial year; every series must stay unique once separators are stripped (no two prefixes
 * where one plus digits could equal the other); a format that has issued a number is locked.
 */
export function seriesFormatProblems(
	type: NumberedDocumentType,
	format: SeriesFormat,
	settings: DocumentNumberingSettings,
	current: SeriesFormat | null,
): NumberFormatProblem[] {
	const problems: NumberFormatProblem[] = [];
	if (settings.lockedTypes.includes(type) && current && JSON.stringify(current) !== JSON.stringify(format)) {
		problems.push('locked_after_first_issue');
	}
	const longest = renderSeriesNumber(format, '2099-00', 10 ** format.digits - 1);
	if (isGstDocument(type) && longest.length > GST_MAX) problems.push('too_long_for_gst');
	const others = Object.entries(settings.series).filter(([other]) => other !== type);
	if (others.some(([, otherFormat]) => otherFormat.prefix === format.prefix)) problems.push('prefix_clash');
	// With separators stripped (the SMS form), `TI` + `2627…` must never read as another prefix's number.
	else if (
		others.some(
			([, otherFormat]) =>
				otherFormat.prefix.startsWith(format.prefix) || format.prefix.startsWith(otherFormat.prefix),
		)
	) {
		problems.push('not_unique_without_separators');
	}
	return problems;
}

/** `ST-2611-482190` (OD18 Final): the IST year and month, then random digits (crypto random at the caller). */
export function renderYearMonthOrderNumber(
	format: Extract<OrderNumberFormat, { kind: 'yearMonthRandom' }>,
	at: Date,
	randomDigit: () => number,
): string {
	const ist = new Date(at.getTime() + 330 * 60_000);
	const yymm = `${String(ist.getUTCFullYear()).slice(2)}${String(ist.getUTCMonth() + 1).padStart(2, '0')}`;
	let digits = '';
	for (let i = 0; i < format.randomDigits; i++) digits += String(Math.floor(randomDigit()) % 10);
	return [format.prefix, yymm, digits].join(format.separator);
}

/** `ST-48213-90761`: random digits in fixed-width groups (an earlier recommended shape, kept as an option). */
export function renderRandomOrderNumber(
	format: Extract<OrderNumberFormat, { kind: 'randomGroups' }>,
	randomDigit: () => number,
): string {
	const groups = format.groups.map((width) => {
		let digits = '';
		for (let i = 0; i < width; i++) {
			const digit = Math.floor(randomDigit()) % 10;
			// The first digit of a group is never 0, so the number reads the same when spoken.
			digits += i === 0 && digit === 0 ? '1' : String(digit);
		}
		return digits;
	});
	return [format.prefix, ...groups].join(format.separator);
}

/** Order numbers from a counter (`SO/26-27/000001`, `ST10001`). */
export function renderSequencedOrderNumber(
	format: Extract<OrderNumberFormat, { kind: 'financialYearSequence' | 'runningNumber' }>,
	financialYear: string,
	sequence: number,
): string {
	if (format.kind === 'financialYearSequence') {
		return [format.prefix, shortYear(financialYear), String(sequence).padStart(format.digits, '0')].join(
			format.separator,
		);
	}
	return `${format.prefix}${String(format.start - 1 + sequence).padStart(format.digits, '0')}`;
}

/** The counter an order format needs, or null for random numbers. */
export function orderSeriesKey(
	format: OrderNumberFormat,
	financialYear: string,
): { series: string; period: string } | null {
	if (format.kind === 'randomGroups' || format.kind === 'yearMonthRandom') return null;
	return { series: 'doc:order', period: format.kind === 'financialYearSequence' ? financialYear : 'all' };
}

/** A parcel, return or payment request number: the order number plus `/P1`. */
export function renderChildNumber(orderNumber: string, format: OrderChildFormat, sequence: number): string {
	return `${orderNumber}${format.separator}${format.letter}${sequence}`;
}

/** An example of every row, for the settings screen. */
export function numberingExamples(settings: DocumentNumberingSettings, financialYear: string): Record<string, string> {
	const out: Record<string, string> = {};
	const fixedDigits = (() => {
		const digits = [4, 8, 2, 1, 9, 0, 7, 6, 1, 3];
		let at = 0;
		return () => digits[at++ % digits.length] as number;
	})();
	const sample = new Date('2026-11-15T06:30:00Z');
	const order =
		settings.order.kind === 'yearMonthRandom'
			? renderYearMonthOrderNumber(settings.order, sample, fixedDigits)
			: settings.order.kind === 'randomGroups'
				? renderRandomOrderNumber(settings.order, fixedDigits)
				: renderSequencedOrderNumber(settings.order, financialYear, 1);
	out.order = order;
	out.parcel = renderChildNumber(order, settings.parcel, 1);
	out.return = renderChildNumber(order, settings.return, 1);
	out.paymentRequest = renderChildNumber(order, settings.paymentRequest, 1);
	for (const [type, format] of Object.entries(settings.series))
		out[type] = renderSeriesNumber(format, financialYear, 1);
	return out;
}
