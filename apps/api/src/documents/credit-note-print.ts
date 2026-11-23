import type { CreditNote, CreditNoteLine, DebitNote } from '@saha-textile/contracts';
import { gstStateName, rupeesInWords } from '@saha-textile/core-domain';

import { longDate } from '../purchasing/purchase-order-document';
import type { DocumentData, DocumentRow } from './document-data';
import { money } from './record-prints';

const REFUND_WORDS: Record<CreditNote['refundTo'], string> = {
	original_payment: 'The original payment',
	bank_transfer: 'A bank transfer to the customer',
	customer_account: 'Kept on the customer’s account',
};

const state = (code: string) => (code === '96' ? 'Outside India (96)' : `${gstStateName(code) ?? code} (${code})`);

type Note = Pick<
	CreditNote,
	'lines' | 'interState' | 'taxableINR' | 'cgstINR' | 'sgstINR' | 'igstINR' | 'roundOffINR' | 'totalINR' | 'buyer'
>;

/** The lines, HSN summary and totals a credit or debit note prints, from its own lines (B4 print). */
function noteBody(note: Note, totalLabel: string) {
	const rows: DocumentRow[] = note.lines.map((line: CreditNoteLine, index) => ({
		kind: 'line',
		depth: 0,
		cells: {
			index: String(index + 1),
			item: line.delivery ? 'Delivery charge share' : line.title,
			hsn: line.hsn,
			qty: line.delivery ? '—' : `${line.quantity} ${line.unit === 'MTR' ? 'm' : 'pc'}`,
			rate: money(line.unitPriceINR),
			taxable: money(line.taxableINR),
			gstRate: `${line.ratePercent}%`,
			tax: money(line.cgstINR + line.sgstINR + line.igstINR),
			amount: money(line.totalINR),
		},
		sku: line.sku,
	}));
	const byHsn = new Map<string, { hsn: string; taxable: number; tax: number; rate: number }>();
	for (const line of note.lines.filter((l) => !l.delivery)) {
		const key = `${line.hsn}@${line.ratePercent}`;
		const row = byHsn.get(key) ?? { hsn: line.hsn, taxable: 0, tax: 0, rate: line.ratePercent };
		row.taxable += line.taxableINR;
		row.tax += line.cgstINR + line.sgstINR + line.igstINR;
		byHsn.set(key, row);
	}
	const taxRows = note.interState
		? [{ label: 'IGST', value: money(note.igstINR) }]
		: [
				{ label: 'CGST', value: money(note.cgstINR) },
				{ label: 'SGST', value: money(note.sgstINR) },
			];
	return {
		taxHeading: note.interState ? 'IGST' : 'CGST + SGST',
		rows,
		hsnSummary: [...byHsn.values()].map((row) => ({
			hsn: row.hsn,
			taxable: money(row.taxable),
			rate: `${row.rate}%`,
			tax: money(row.tax),
		})),
		totals: {
			totals: [
				{ label: 'Taxable value', value: money(note.taxableINR) },
				...taxRows,
				{ label: totalLabel, value: money(note.totalINR) },
			],
			roundOff: [{ label: 'Round off', value: money(note.roundOffINR) }],
		},
	};
}

const buyerLines = (buyer: Note['buyer']) =>
	[buyer.name, buyer.address, state(buyer.stateCode), ...(buyer.gstin ? [`GSTIN ${buyer.gstin}`] : [])].filter(
		Boolean,
	);

/** A credit note as its print reads it (Rule 53 particulars): which invoice it quotes, why, and where the money goes. */
export function creditNoteData(note: CreditNote, seller: { name: string; lines: string[] }): DocumentData {
	const number = note.number ?? 'Draft';
	return {
		doc: 'creditNote',
		title: 'Credit note',
		number,
		date: longDate(note.date),
		seller,
		values: {
			noteNo: number,
			noteDate: longDate(note.date),
			originalInvoiceNo: note.invoiceNumber,
			originalInvoiceDate: longDate(note.invoiceDate),
			placeOfSupply: state(note.placeOfSupply),
			reason: note.reason,
			refundTo: REFUND_WORDS[note.refundTo],
			amountInWords: rupeesInWords(note.totalINR),
		},
		parties: { billTo: { heading: 'Billed to', lines: buyerLines(note.buyer) } },
		...noteBody(note, 'Credited'),
	};
}

/** A debit note undoing a credit note (B5, B9): the same lines, quoting the invoice and the note it undoes. */
export function debitNoteData(note: DebitNote, seller: { name: string; lines: string[] }): DocumentData {
	return {
		doc: 'debitNote',
		title: 'Debit note',
		number: note.number,
		date: longDate(note.date),
		seller,
		values: {
			noteNo: note.number,
			noteDate: longDate(note.date),
			originalInvoiceNo: note.invoiceNumber,
			reason: `${note.reason} (undoes credit note ${note.creditNoteNumber})`,
			amountInWords: rupeesInWords(note.totalINR),
		},
		parties: { party: { heading: 'To', lines: buyerLines(note.buyer) } },
		...noteBody(note, 'Total'),
	};
}
