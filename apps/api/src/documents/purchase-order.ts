import type { PurchaseOrder, Supplier } from '@saha-textile/contracts';
import { billedUnits, formatQuantity, formatRupees } from '@saha-textile/core-domain';

import { longDate } from '../purchasing/purchase-order-document';
import type { DocumentData } from './document-data';

/**
 * A purchase order on its document format (bundle builder brief F-BUY, approved 2026-11-22): the shop it goes out
 * from, the supplier, each line with the supplier's own code, quantity, agreed price and GST, and the expected total
 * before GST. Replaces the theme's invoice template for purchase orders.
 */
export function purchaseOrderData(
	order: PurchaseOrder,
	supplier: Supplier | null,
	seller: DocumentData['seller'],
): DocumentData {
	const supplierLines = [
		supplier?.legalName ?? order.supplierName,
		...(supplier
			? [
					[supplier.address.line, supplier.address.city, `${supplier.stateName} ${supplier.address.pin}`]
						.filter(Boolean)
						.join(', '),
				]
			: []),
		supplier?.gstin ? `GSTIN ${supplier.gstin} (State ${supplier.stateCode})` : '',
		[supplier?.phone, supplier?.email].filter(Boolean).join(' · '),
	].filter(Boolean);
	return {
		doc: 'purchaseOrder',
		title: 'Purchase order',
		number: order.number,
		date: longDate(order.createdAt.slice(0, 10)),
		seller,
		values: {
			poNo: order.number,
			date: longDate(order.createdAt.slice(0, 10)),
			expectedBy: longDate(order.expectedBy),
			...(order.noteToSupplier ? { noteToSupplier: order.noteToSupplier } : {}),
		},
		parties: {
			supplier: { heading: 'To', lines: supplierLines },
			deliverTo: { heading: 'Deliver to', lines: [order.deliverTo] },
		},
		rows: order.lines.map((line, at) => ({
			kind: 'line',
			depth: 0,
			cells: {
				index: String(at + 1),
				item: [line.title, line.optionsLabel].filter(Boolean).join(', '),
				supplierCode: line.supplierItemCode ?? '',
				qty: formatQuantity(line.quantity, line.soldBy),
				rate: `${formatRupees(line.agreedPriceINR)}${line.soldBy === 'metre' ? ' / m' : ''}`,
				gstRate: `${line.gstRatePct}%`,
				amount: formatRupees(
					Math.round(billedUnits(line.quantity, line.soldBy) * line.agreedPriceINR * 100) / 100,
				),
			},
			sku: line.sku,
		})),
		totals: { totals: [{ label: 'Expected total (before GST)', value: formatRupees(order.orderedValueINR) }] },
		signatures: {},
	};
}
