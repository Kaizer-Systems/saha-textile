import { INVOICE_COPY_LABELS, type InvoiceCopy, type TaxInvoice } from '@saha-textile/contracts';
import { documentQuantityText, documentUnitPrice, gstStateName, rupeesInWords } from '@saha-textile/core-domain';

import { longDate } from '../purchasing/purchase-order-document';
import type { DocumentData, DocumentRow } from './document-data';
import { money } from './record-prints';

/** The e-invoice facts printed in the band when the invoice has an IRN (addendum 2, EI8). */
export interface InvoiceEDocs {
	irn: string | null;
	ackNo: string | null;
	ackDate: string | null;
	signedQrSvg: string | null;
	ewayBill: string | null;
}

/**
 * A tax invoice as its print reads it (accounts brief D1, AE5): one of the three Rule 48 copies, the HSN summary,
 * and the IRN band only when the invoice has an IRN. "Rates wait for the CA" is marked on the admin screens (the
 * order's invoice card and the invoice's Checks), never on the buyer's copy.
 */
export function taxInvoiceData(
	invoice: TaxInvoice,
	seller: { name: string; lines: string[] },
	copy: InvoiceCopy,
	edocs: InvoiceEDocs | null,
): DocumentData {
	const state = (code: string) => (code === '96' ? 'Outside India (96)' : `${gstStateName(code) ?? code} (${code})`);
	const rows: DocumentRow[] = invoice.lines.map((line, index) => ({
		kind: 'line',
		depth: 0,
		cells: {
			item: `${index + 1}. ${line.title}`,
			hsn: line.hsn,
			qty: documentQuantityText(line),
			rate: money(documentUnitPrice(line)),
			taxable: money(line.taxableINR),
			gstRate: `${line.ratePercent}%`,
			tax: money(line.cgstINR + line.sgstINR + line.igstINR),
			amount: money(line.totalINR),
		},
		sku: line.sku,
	}));
	const byHsn = new Map<string, { hsn: string; taxable: number; tax: number; rate: number }>();
	for (const line of invoice.lines) {
		const key = `${line.hsn}@${line.ratePercent}`;
		const row = byHsn.get(key) ?? { hsn: line.hsn, taxable: 0, tax: 0, rate: line.ratePercent };
		row.taxable += line.taxableINR;
		row.tax += line.cgstINR + line.sgstINR + line.igstINR;
		byHsn.set(key, row);
	}
	// A bill of supply (composition) shows no tax at all.
	const taxRows = invoice.billOfSupply
		? []
		: invoice.interState
			? [{ label: 'IGST', value: money(invoice.igstINR) }]
			: [
					{ label: 'CGST', value: money(invoice.cgstINR) },
					{ label: 'SGST', value: money(invoice.sgstINR) },
				];
	const party = (name: string, gstin: string | null, address: string, code: string) =>
		[name, address, state(code), ...(gstin ? [`GSTIN ${gstin}`] : [])].filter(Boolean);
	return {
		doc: 'taxInvoice',
		title: invoice.billOfSupply ? 'Bill of supply' : 'Tax invoice',
		number: invoice.number,
		date: longDate(invoice.date),
		seller,
		...(edocs?.signedQrSvg ? { qrSvg: edocs.signedQrSvg } : {}),
		values: {
			copyLabel: INVOICE_COPY_LABELS[copy],
			invoiceNo: invoice.number,
			invoiceDate: longDate(invoice.date),
			orderNo: invoice.orderNumber,
			placeOfSupply: state(invoice.placeOfSupply),
			reverseCharge: 'No',
			amountInWords: rupeesInWords(invoice.totalINR),
			...(edocs?.irn ? { irn: edocs.irn } : {}),
			...(edocs?.ackNo ? { ackNo: edocs.ackNo } : {}),
			...(edocs?.ackDate ? { ackDate: edocs.ackDate } : {}),
			...(edocs?.ewayBill ? { ewayBill: edocs.ewayBill } : {}),
		},
		parties: {
			billTo: {
				heading: 'Billed to',
				lines: party(invoice.buyer.name, invoice.buyer.gstin, invoice.buyer.address, invoice.buyer.stateCode),
			},
			shipTo: {
				heading: 'Shipped to',
				lines: party(invoice.buyer.name, null, invoice.buyer.address, invoice.placeOfSupply),
			},
		},
		// A bill of supply (composition) shows no GST rate, tax or tax summary.
		...(invoice.billOfSupply
			? { hideColumns: ['gstRate', 'tax'] }
			: { taxHeading: invoice.interState ? 'IGST' : 'CGST + SGST' }),
		rows,
		hsnSummary: (invoice.billOfSupply ? [] : [...byHsn.values()]).map((row) => ({
			hsn: row.hsn,
			taxable: money(row.taxable),
			rate: `${row.rate}%`,
			tax: money(row.tax),
		})),
		totals: {
			totals: [
				{ label: 'Taxable value', value: money(invoice.taxableINR) },
				...taxRows,
				...(invoice.shippingINR ? [{ label: 'Delivery (incl. GST)', value: money(invoice.shippingINR) }] : []),
				{ label: 'Total', value: money(invoice.totalINR) },
			],
			roundOff: [{ label: 'Round off', value: money(invoice.roundOffINR) }],
		},
		signatures: {
			declaration: invoice.billOfSupply
				? 'Composition taxable person, not eligible to collect tax on supplies. We declare that this document shows the actual price of the goods described and that all particulars are true and correct.'
				: 'We declare that this document shows the actual price of the goods described and that all particulars are true and correct.',
		},
	};
}
