/**
 * The by-hand path's helpers (EI4B, EI6B). The e-invoice portal's bulk upload takes a JSON list of invoices in
 * the INV-01 schema, which core builds. For e-way bills the portal's bulk-upload layout is not published in the
 * API docs, so until it is checked against the portal's own bulk tool the popup shows the details to type
 * (Part A and Part B) instead of a file.
 */

/** The file to upload on the e-invoice portal (a list with this one invoice). */
export const eInvoicePortalFile = (invoiceJson: Record<string, unknown>): string =>
	JSON.stringify([invoiceJson], null, 2);

export interface DetailRow {
	part: 'A' | 'B';
	label: string;
	value: string;
}

const MODE: Record<string, string> = {
	'1': 'Road',
	'2': 'Rail',
	'3': 'Air',
	'4': 'Ship',
	'5': 'In transit',
	'6': 'Metro rail',
};
const SUB: Record<string, string> = {
	'1': 'Supply',
	'3': 'Export',
	'4': 'Job work',
	'5': 'For own use',
	'7': 'Sales return',
	'8': 'Others',
	'12': 'Exhibition or fairs',
};

/** The e-way bill's fields in the portal's order, to type on ewaybillgst.gov.in › Generate new. */
export function eWayBillDetailsSheet(ewb: Record<string, unknown>): DetailRow[] {
	const s = (key: string): string => String(ewb[key] ?? '');
	const items = (ewb['itemList'] as Record<string, unknown>[] | undefined) ?? [];
	return [
		{
			part: 'A',
			label: 'Transaction',
			value: `${s('supplyType') === 'I' ? 'Inward' : 'Outward'} · ${SUB[s('subSupplyType')] ?? s('subSupplyType')}`,
		},
		{ part: 'A', label: 'Document', value: `${s('docType')} ${s('docNo')} · ${s('docDate')}` },
		{
			part: 'A',
			label: 'From',
			value: `${s('fromGstin')} · ${s('fromTrdName')} · ${s('fromAddr1')} ${s('fromAddr2')} · ${s('fromPlace')} ${s('fromPincode')} · state ${s('actFromStateCode')}`,
		},
		{
			part: 'A',
			label: 'To',
			value: `${s('toGstin')} · ${s('toTrdName')} · ${s('toAddr1')} ${s('toAddr2')} · ${s('toPlace')} ${s('toPincode')} · state ${s('actToStateCode')}`,
		},
		...items.map((i, n) => ({
			part: 'A' as const,
			label: `Item ${n + 1}`,
			value: `${String(i['productName'])} · HSN ${String(i['hsnCode'])} · ${String(i['quantity'])} ${String(i['qtyUnit'])} · taxable ₹${String(i['taxableAmount'])} · IGST ${String(i['igstRate'])}% / CGST ${String(i['cgstRate'])}% / SGST ${String(i['sgstRate'])}%`,
		})),
		{
			part: 'A',
			label: 'Values',
			value: `Taxable ₹${s('totalValue')} · CGST ₹${s('cgstValue')} · SGST ₹${s('sgstValue')} · IGST ₹${s('igstValue')} · other ₹${s('otherValue')} · total ₹${s('totInvValue')}`,
		},
		{
			part: 'B',
			label: 'Transport',
			value: `${MODE[s('transMode')] ?? 'Part A only (transporter adds Part B)'} · ${s('transDistance')} km`,
		},
		{
			part: 'B',
			label: 'Transporter',
			value: [s('transporterId'), s('transporterName')].filter(Boolean).join(' · ') || '—',
		},
		{
			part: 'B',
			label: 'Vehicle or document',
			value: [s('vehicleNo'), s('transDocNo'), s('transDocDate')].filter(Boolean).join(' · ') || '—',
		},
	];
}
