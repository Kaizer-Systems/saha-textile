import type { Order } from '@saha-textile/contracts';
import { packLines } from '@saha-textile/core-domain';

import type { DocumentData, DocumentRow } from './document-data';

type Line = Order['lines'][number];

const titleOf = (line: Line | undefined): string =>
	line ? (line.title['en'] ?? Object.values(line.title)[0] ?? line.sku) : '';

/**
 * The packing slip (bundle builder brief E08/F-PARCEL, approved 2026-11-22): the Pack list printed — every physical
 * piece flat, a tick box each, where it came from, and no prices.
 */
export function packingSlipData(
	order: Order,
	seller: DocumentData['seller'],
	options: { parcelNo: string; date: string },
): DocumentData {
	const byId = new Map(order.lines.map((line) => [line.lineId ?? '', line]));
	const own = order.lines.filter((line) => !line.parentLineId);
	const lineNo = (line: Line) => own.indexOf(line) + 1;
	const pieceNo = (line: Line) =>
		order.lines.filter((row) => row.parentLineId === line.parentLineId && row.role === 'piece').indexOf(line) + 1;
	const fromOf = (line: Line): string => {
		const parent = line.parentLineId ? byId.get(line.parentLineId) : undefined;
		if (!parent) return `Line ${lineNo(line)}`;
		if (line.role === 'piece') return `${titleOf(parent)}, piece ${pieceNo(line)}`;
		if (line.role === 'extra') return `Extra with ${titleOf(parent)}`;
		if (parent.role === 'piece') {
			const set = parent.parentLineId ? byId.get(parent.parentLineId) : undefined;
			return `Free with piece ${pieceNo(parent)} of ${titleOf(set)}`;
		}
		return `Free with line ${lineNo(parent)}`;
	};
	const rows: DocumentRow[] = packLines(order.lines).map((line, at) => ({
		kind: 'line',
		depth: 0,
		cells: {
			index: String(at + 1),
			item: [titleOf(line), ...Object.values(line.attributes ?? {})].filter(Boolean).join(' · '),
			qty: String(line.quantity),
			cameWith: fromOf(line),
		},
		sku: line.sku,
	}));
	const delivery = order.addresses?.delivery ?? null;
	const phone = delivery?.mobile ? `+${delivery.mobile.countryCallingCode} ${delivery.mobile.number}` : '';
	return {
		doc: 'packingSlip',
		title: 'Packing slip',
		number: options.parcelNo,
		date: options.date,
		seller,
		values: {
			parcelNo: options.parcelNo,
			orderNo: order.orderNumber,
			date: options.date,
			// The courier as the order chose it; the AWB prints once shipping labels are connected (Shiprocket).
			...(order.shipping?.provider || order.shipping?.method
				? { courier: [order.shipping.provider, order.shipping.method].filter(Boolean).join(' · ') }
				: {}),
		},
		parties: delivery
			? {
					shipTo: {
						heading: 'Ship to',
						lines: [
							delivery.fullName,
							delivery.line1,
							delivery.line2 ?? '',
							[delivery.city, delivery.state, delivery.postalCode].filter(Boolean).join(', '),
							phone,
						].filter(Boolean),
					},
				}
			: {},
		rows,
		signatures: { packedBy: '' },
	};
}
