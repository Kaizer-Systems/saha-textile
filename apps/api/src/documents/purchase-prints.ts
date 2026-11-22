import type { PurchaseEntry, PurchaseReturn, Supplier } from '@saha-textile/contracts';
import { formatQuantity, formatRupees } from '@saha-textile/core-domain';

import { longDate } from '../purchasing/purchase-order-document';
import type { DocumentData } from './document-data';

/**
 * Goods receipt, debit note and delivery challan on their document formats (bundle builder brief F-BUY / F-NOTES,
 * approved 2026-11-22), replacing the theme's invoice template. Same content as before: what was counted, what goes
 * back and why, against which bill.
 */

function supplierBox(name: string, supplier: Supplier | null, heading: string) {
	return {
		heading,
		lines: [
			supplier?.legalName ?? name,
			...(supplier
				? [
						[supplier.address.line, supplier.address.city, `${supplier.stateName} ${supplier.address.pin}`]
							.filter(Boolean)
							.join(', '),
					]
				: []),
			supplier?.gstin ? `GSTIN ${supplier.gstin} (State ${supplier.stateCode})` : '',
		].filter(Boolean),
	};
}

const itemName = (line: { title: string; optionsLabel: string }) =>
	[line.title, line.optionsLabel].filter(Boolean).join(', ');

export function goodsReceiptData(
	entry: PurchaseEntry,
	supplier: Supplier | null,
	seller: DocumentData['seller'],
): DocumentData {
	const number = entry.number ?? 'Not posted yet';
	return {
		doc: 'purchaseEntry',
		title: 'Goods receipt',
		number,
		date: longDate(entry.goodsReceivedOn),
		seller,
		values: {
			entryNo: number,
			billNo: entry.billNumber,
			billDate: longDate(entry.billDate),
			receivedOn: longDate(entry.goodsReceivedOn),
			...(entry.purchaseOrderNumber ? { poNo: entry.purchaseOrderNumber } : {}),
		},
		parties: { supplier: supplierBox(entry.supplierName, supplier, 'From') },
		rows: entry.lines.map((line, at) => {
			const short = [
				line.damaged ? `${formatQuantity(line.damaged, line.soldBy)} damaged` : '',
				line.missing ? `${formatQuantity(line.missing, line.soldBy)} short` : '',
			].filter(Boolean);
			return {
				kind: 'line' as const,
				depth: 0 as const,
				cells: {
					index: String(at + 1),
					item: itemName(line),
					hsn: line.hsnOnBill ?? line.productHsn ?? '',
					ordered: formatQuantity(line.quantity, line.soldBy),
					received: `${formatQuantity(line.accepted ?? 0, line.soldBy)}${short.length ? ` (${short.join(', ')})` : ''}`,
					rate: formatRupees(line.unitPriceINR),
					taxable: formatRupees(line.taxableINR),
					gstRate: `${line.gstRatePct}%`,
					amount: formatRupees(line.lineTotalINR),
				},
				sku: line.sku,
			};
		}),
		totals: {
			totals: [
				{ label: 'Taxable value', value: formatRupees(entry.totals.taxableINR) },
				{
					label: 'GST',
					value: formatRupees(entry.totals.cgstINR + entry.totals.sgstINR + entry.totals.igstINR),
				},
				{ label: 'Total on the bill', value: formatRupees(entry.totals.totalINR) },
			],
		},
		signatures: { receivedBy: '' },
	};
}

const REASONS: Record<PurchaseReturn['reason'], string> = {
	damaged_on_arrival: 'Damaged on arrival',
	wrong_item: 'Wrong item',
	short_supplied: 'Short supplied',
	quality_after_accepting: 'Quality problem found after accepting',
	extra_sent: 'Extra pieces sent',
	other: 'Other',
};

/** A purchase return as its debit note (to the supplier) or as the challan the goods travel on (not a sale). */
export function purchaseReturnData(
	kind: 'debit-note' | 'challan',
	doc: PurchaseReturn,
	entry: PurchaseEntry | null,
	supplier: Supplier | null,
	seller: DocumentData['seller'],
): DocumentData {
	const challan = kind === 'challan';
	const number = (challan ? doc.challanNumber : doc.number) ?? '';
	const date = doc.sentAt ? longDate(doc.sentAt.slice(0, 10)) : '';
	const taxHeading = doc.taxType === 'intra_state' ? 'CGST + SGST' : doc.taxType === 'inter_state' ? 'IGST' : 'GST';
	const against = entry
		? `Bill ${entry.billNumber} of ${longDate(entry.billDate)} (our ${doc.purchaseEntryNumber ?? ''})`
		: (doc.purchaseEntryNumber ?? '');
	const hsnOf = (entryLineId: string) => {
		const line = entry?.lines.find((candidate) => candidate.lineId === entryLineId);
		return line?.hsnOnBill ?? line?.productHsn ?? '';
	};
	const rows = doc.lines.map((line, at) => ({
		kind: 'line' as const,
		depth: 0 as const,
		cells: {
			index: String(at + 1),
			item: itemName(line),
			hsn: hsnOf(line.entryLineId),
			qty: formatQuantity(line.quantity, line.soldBy),
			rate: formatRupees(line.unitCostINR),
			taxable: formatRupees(line.taxableINR),
			gstRate: `${line.gstRatePct}%`,
			tax: formatRupees(line.taxINR),
			amount: formatRupees(line.totalINR),
			value: formatRupees(line.taxableINR),
		},
		sku: line.sku,
	}));
	const note = [REASONS[doc.reason], doc.noteToSupplier ?? ''].filter(Boolean).join('. ');
	if (challan) {
		return {
			doc: 'deliveryChallan',
			title: 'Delivery challan',
			number,
			date,
			seller,
			values: {
				challanNo: number,
				date,
				purpose: `Goods returned to the supplier (${REASONS[doc.reason].toLowerCase()}); not a sale`,
				...(doc.courier
					? { transport: [doc.courier, doc.docket ? `docket ${doc.docket}` : ''].filter(Boolean).join(', ') }
					: {}),
			},
			parties: { consignee: supplierBox(doc.supplierName, supplier, 'Consignee') },
			rows,
			totals: {
				totals: [
					{
						label: 'Value of goods',
						value: formatRupees(doc.lines.reduce((sum, line) => sum + line.taxableINR, 0)),
					},
				],
			},
			signatures: {},
		};
	}
	return {
		doc: 'debitNote',
		title: 'Debit note',
		number,
		date,
		seller,
		values: { noteNo: number, noteDate: date, originalInvoiceNo: against, reason: note },
		parties: { party: supplierBox(doc.supplierName, supplier, 'To') },
		taxHeading,
		rows,
		totals: { totals: [{ label: 'Total', value: formatRupees(doc.totalINR) }] },
		signatures: {},
	};
}
