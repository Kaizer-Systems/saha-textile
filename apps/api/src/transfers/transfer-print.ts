import { TaxInvoice, type Location, type StockTransfer, type TransferLine } from '@saha-textile/contracts';
import { branchInvoice, formatQuantity, formatRupees } from '@saha-textile/core-domain';

import type { DocumentData } from '../documents/document-data';

import { taxInvoiceData } from '../documents/tax-invoice-print';

const addressOf = (location: Location) => [location.address, location.city, location.pin].filter(Boolean).join(', ');

/**
 * A transfer's print (accounts brief N7, N8). Within one GSTIN the pieces travel on a delivery challan (Rule 55): not a
 * sale. To another GSTIN they travel on a tax invoice at cost with IGST, the receiving location as the buyer. Only a
 * transfer that has left is printed, so its numbers and values are there.
 */
export function transferDocument(
	transfer: StockTransfer,
	seller: { name: string; lines: string[] },
	from: Location,
	to: Location,
): DocumentData {
	const invoice = transfer.branchInvoice;
	if (invoice) {
		const built = branchInvoice(
			transfer.lines.map((l) => ({
				sku: l.sku,
				hsn: l.hsn,
				quantity: l.quantity,
				valueINR: l.valueINR as number,
			})),
		);
		const toState = invoice.toGstin.slice(0, 2);
		const taxInvoice = TaxInvoice.parse({
			id: transfer.id,
			number: invoice.number,
			date: invoice.date,
			// A branch invoice exists only when both locations have their own GST registration.
			gstRegistrationId: from.gstRegistrationId as string,
			gstin: invoice.fromGstin,
			locationId: from.id,
			orderId: transfer.id,
			orderNumber: transfer.number,
			seller: {
				name: seller.name,
				gstin: invoice.fromGstin,
				address: addressOf(from),
				stateCode: invoice.fromGstin.slice(0, 2),
			},
			buyer: {
				name: `${to.name} (our branch)`,
				gstin: invoice.toGstin,
				address: addressOf(to),
				stateCode: toState,
			},
			placeOfSupply: toState,
			interState: true,
			// Every line had its HSN and rate when it left (dispatch refuses otherwise), so they pair one to one.
			lines: built.lines.map((line, at) => ({
				lineId: (transfer.lines[at] as TransferLine).lineId,
				sku: line.sku,
				title: (transfer.lines[at] as TransferLine).title,
				hsn: line.hsn as string,
				quantity: line.quantity,
				unitPriceINR: line.valueINR / line.quantity,
				ratePercent: line.ratePercent,
				taxableINR: line.valueINR,
				igstINR: line.igstINR,
				totalINR: Math.round((line.valueINR + line.igstINR) * 100) / 100,
			})),
			taxableINR: invoice.taxableINR,
			cgstINR: 0,
			sgstINR: 0,
			igstINR: invoice.igstINR,
			roundOffINR: 0,
			totalINR: invoice.totalINR,
			createdAt: transfer.updatedAt,
		});
		return taxInvoiceData(taxInvoice, seller, 'original', null);
	}
	return {
		doc: 'deliveryChallan',
		title: 'Delivery challan',
		number: transfer.challanNumber as string,
		date: transfer.updatedAt.slice(0, 10),
		seller,
		values: {
			challanNo: transfer.challanNumber as string,
			date: transfer.updatedAt.slice(0, 10),
			purpose: `Stock transfer ${transfer.number} from ${from.name} to our own ${to.name}; not a sale`,
			// Nothing leaves without its seal number (N5).
			transport: [transfer.vehicle, `seal ${transfer.sealNumber}`].filter(Boolean).join(', '),
			...(transfer.ewayBillNumber ? { ewayBill: transfer.ewayBillNumber } : {}),
		},
		parties: { consignee: { heading: 'Consignee', lines: [to.name, addressOf(to)].filter(Boolean) } },
		rows: transfer.lines.map((line, at) => ({
			kind: 'line' as const,
			depth: 0 as const,
			cells: {
				index: String(at + 1),
				item: line.title,
				hsn: line.hsn ?? '',
				qty: formatQuantity(line.quantity, line.soldBy),
				value: formatRupees(line.valueINR as number),
			},
			sku: line.sku,
		})),
		totals: { totals: [{ label: 'Value of goods (at cost)', value: formatRupees(transfer.valueINR) }] },
		signatures: {},
	};
}
