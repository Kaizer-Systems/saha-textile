import { statementAmount, statementDate } from '@saha-textile/core-domain/bank-statement';

import type { SettlementRowWrite, StatementDateFormat } from '@saha-textile/contracts';

/**
 * Reading a payout file (accounts brief Q10): which column holds the payout's reference, its day, the payment it pays,
 * and the money; guessed from the gateway's or courier's own headings, changeable before reading.
 */

export const PAYOUT_FIELDS = ['payoutReference', 'date', 'reference', 'gross', 'charges', 'gst'] as const;
export type PayoutField = (typeof PAYOUT_FIELDS)[number];
export type PayoutColumns = Record<PayoutField, number | null>;

const GUESSES: ReadonlyArray<[PayoutField, RegExp]> = [
	['payoutReference', /utr|settlement\s*(id|ref)|payout\s*(id|ref)|remittance\s*(id|ref)/i],
	['date', /settle\w*\s*date|payout\s*date|remit\w*\s*date|date/i],
	['reference', /tracking|order\s*(no|number|id)|awb|txn\s*id|transaction\s*id|payment\s*id|reference/i],
	['gst', /gst|tax/i],
	['charges', /fee|charge|commission|tdr/i],
	['gross', /gross|cod\s*amount|txn\s*amount|amount/i],
];

/** The heading row (the first with three cells or more) and each field's column, from the headings. */
export function guessPayoutColumns(rows: readonly (readonly string[])[]): {
	headingAt: number;
	columns: PayoutColumns;
} {
	const headingAt = Math.max(
		0,
		rows.findIndex((row) => row.filter((cell) => cell.trim()).length >= 3),
	);
	const heading = rows[headingAt] ?? [];
	const columns = Object.fromEntries(PAYOUT_FIELDS.map((field) => [field, null])) as PayoutColumns;
	const taken = new Set<number>();
	for (const [field, words] of GUESSES) {
		const at = heading.findIndex((cell, index) => !taken.has(index) && words.test(cell.trim()));
		if (at >= 0) {
			columns[field] = at;
			taken.add(at);
		}
	}
	return { headingAt, columns };
}

/** The file's rows after the heading as payout rows, in paise; rows that can't be read are named by their number. */
export function payoutRows(
	rows: readonly (readonly string[])[],
	headingAt: number,
	columns: PayoutColumns,
	format: StatementDateFormat,
): { rows: SettlementRowWrite[]; problems: number[] } {
	const out: SettlementRowWrite[] = [];
	const problems: number[] = [];
	const cell = (row: readonly string[], index: number | null) => (index === null ? '' : (row[index] ?? '').trim());
	rows.forEach((row, at) => {
		if (at <= headingAt || row.every((c) => !c.trim())) return;
		const date = statementDate(cell(row, columns.date), format);
		const gross = statementAmount(cell(row, columns.gross));
		const charges = statementAmount(cell(row, columns.charges));
		const gst = statementAmount(cell(row, columns.gst));
		const payoutReference = cell(row, columns.payoutReference);
		const reference = cell(row, columns.reference);
		if (!date || gross === null || charges === null || gst === null || !payoutReference || !reference) {
			problems.push(at + 1);
			return;
		}
		out.push({
			payoutReference,
			date,
			reference,
			grossPaise: Math.abs(gross),
			chargesPaise: Math.abs(charges),
			gstPaise: Math.abs(gst),
		});
	});
	return { rows: out, problems };
}
