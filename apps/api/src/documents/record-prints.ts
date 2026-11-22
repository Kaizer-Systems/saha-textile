import {
	type Business,
	type LedgerEntry,
	type Order,
	type OrderAddress,
	type OrderPayment,
	type StockCount,
	gstStateName,
} from '@saha-textile/contracts';
import { type OpeningStockRecord, formatQuantity, rupeesInWords } from '@saha-textile/core-domain';

import { longDate } from '../purchasing/purchase-order-document';
import type { DocumentData, DocumentRow } from './document-data';

/**
 * Receipt vouchers, journal vouchers, stock count sheets and opening stock, printed from the records the shop already
 * keeps (owner, 23 Nov: "build them all"), on their document formats. Each builder fills only fields its document's
 * spec names (core `DOCUMENT_SPECS`), with values formatted as the formats print them.
 */

/** "₹10,000.00": documents always print paise. */
export const money = (rupees: number): string =>
	`₹${rupees.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const ADVANCE_TAX = 'None: an advance for goods carries no GST';

/** How a payment came in, in the documents' language. */
export const PAYMENT_METHOD_WORDS: Readonly<Record<string, string>> = {
	gateway: 'Online',
	upi: 'UPI',
	bankTransfer: 'Bank transfer',
	cashOnDelivery: 'Cash on delivery',
	onAccount: 'On account',
	setOff: 'Set-off',
};

/** Goods are supplied where delivery ends: the delivery State with its GST code, or outside India (96). */
export function placeOfSupply(address: OrderAddress | null | undefined): string {
	if (!address) return '';
	const country = address.countryCode ?? address.country;
	if (country !== 'IN' && country !== 'India') return 'Outside India (96)';
	const code = address.gstStateCode;
	if (!code) return address.state ?? '';
	return `${gstStateName(code) ?? address.state ?? ''} (${code})`;
}

function addressLines(address: OrderAddress | null | undefined): string[] {
	if (!address) return [];
	return [
		address.fullName,
		address.line1,
		address.line2 ?? '',
		[address.city, address.state, address.postalCode].filter(Boolean).join(', '),
	].filter(Boolean);
}

const dayOf = (iso: string): string => iso.slice(0, 10);

/** A receipt voucher for money received against an order (RC series, Rule 50). */
export function orderReceiptData(order: Order, payment: OrderPayment, seller: DocumentData['seller']): DocumentData {
	const number = payment.receiptNumber ?? '';
	const billing = order.addresses?.billing ?? order.addresses?.delivery ?? null;
	const payer = order.buyer?.gstin
		? [...addressLines(billing), `GSTIN ${order.buyer.gstin}`]
		: addressLines(billing).length
			? addressLines(billing)
			: [order.buyer?.name ?? ''].filter(Boolean);
	return {
		doc: 'receipt',
		title: 'Receipt voucher',
		number,
		date: longDate(payment.receivedOn ?? dayOf(payment.recordedAt)),
		seller,
		values: {
			receiptNo: number,
			date: longDate(payment.receivedOn ?? dayOf(payment.recordedAt)),
			orderNo: order.orderNumber,
			placeOfSupply: placeOfSupply(order.addresses?.delivery),
			amount: money(payment.amountINR),
			method: PAYMENT_METHOD_WORDS[payment.method] ?? payment.method,
			reference: payment.reference ?? payment.gateway?.reference ?? '',
			taxOnAdvance: ADVANCE_TAX,
			amountInWords: rupeesInWords(payment.amountINR),
		},
		parties: { payer: { heading: 'Received from', lines: payer } },
		signatures: { signature: 'Authorised signatory' },
	};
}

function businessBox(business: Business, heading: string) {
	const address = business.registeredAddress;
	return {
		heading,
		lines: [
			business.legalName,
			[address.line, address.city, address.pin].filter(Boolean).join(', '),
			business.gstin ? `GSTIN ${business.gstin}` : '',
		].filter(Boolean),
	};
}

/** A receipt on a business's customer account: money received, not tied to one order. */
export function businessReceiptData(
	business: Business,
	entry: LedgerEntry,
	seller: DocumentData['seller'],
): DocumentData {
	const amount = Math.abs(entry.amountINR);
	const [method, reference] = (entry.note ?? '').split(' · ');
	const number = entry.documentNumber ?? '';
	return {
		doc: 'receipt',
		title: 'Receipt voucher',
		number,
		date: longDate(dayOf(entry.at)),
		seller,
		values: {
			receiptNo: number,
			date: longDate(dayOf(entry.at)),
			orderNo: 'On account',
			placeOfSupply: business.gstin
				? `${gstStateName(business.gstin.slice(0, 2)) ?? ''} (${business.gstin.slice(0, 2)})`
				: '',
			amount: money(amount),
			method: PAYMENT_METHOD_WORDS[method ?? ''] ?? method ?? '',
			reference: reference ?? '',
			taxOnAdvance: ADVANCE_TAX,
			amountInWords: rupeesInWords(amount),
		},
		parties: { payer: businessBox(business, 'Received from') },
		signatures: { signature: 'Authorised signatory' },
	};
}

const SIDE_ACCOUNT: Readonly<Record<string, string>> = {
	receivable: 'Receivable from',
	payable: 'Payable to',
};

/**
 * A journal voucher (JV series): one set-off or its reversal, both of its entries. A negative entry lowers the
 * account it sits in: a receivable is credited, a payable debited.
 */
export function journalData(
	business: Business,
	entries: readonly LedgerEntry[],
	seller: DocumentData['seller'],
): DocumentData {
	const first = entries[0];
	const number = first?.documentNumber ?? '';
	const rows: DocumentRow[] = entries.map((entry) => {
		const account = `${SIDE_ACCOUNT[entry.side] ?? entry.side} ${business.legalName}`;
		const lowers = entry.amountINR < 0;
		const amount = money(Math.abs(entry.amountINR));
		const debit = entry.side === 'receivable' ? !lowers : lowers;
		return {
			kind: 'line',
			depth: 0,
			cells: { account, debit: debit ? amount : '', credit: debit ? '' : amount },
		};
	});
	return {
		doc: 'journal',
		title: 'Journal voucher',
		number,
		date: first ? longDate(dayOf(first.at)) : '',
		seller,
		values: {
			voucherNo: number,
			date: first ? longDate(dayOf(first.at)) : '',
			narration: [first?.kind === 'reversal' ? 'Set-off reversed' : 'Set-off', first?.note]
				.filter(Boolean)
				.join(': '),
		},
		parties: {},
		rows,
		signatures: { preparedBy: 'Accounts', approvedBy: '' },
	};
}

/** The stock count sheet: expected and counted per SKU (expected stays blank where the counter may not see it). */
export function stockCountData(count: StockCount, seller: DocumentData['seller']): DocumentData {
	const figure = (value: number | null, soldBy: 'piece' | 'metre') =>
		value === null ? '' : formatQuantity(value, soldBy);
	return {
		doc: 'stockCount',
		title: 'Stock count sheet',
		number: count.number,
		date: longDate(dayOf(count.startedAt)),
		seller,
		values: { countNo: count.number, date: longDate(dayOf(count.startedAt)), area: count.label },
		parties: {},
		rows: count.lines.map((line, at) => ({
			kind: 'line',
			depth: 0,
			cells: {
				index: String(at + 1),
				item: [line.title, line.optionsLabel].filter(Boolean).join(' · '),
				expected: figure(line.expected, line.soldBy),
				counted: figure(line.counted, line.soldBy),
				difference: figure(line.difference, line.soldBy),
			},
			sku: line.sku,
		})),
		signatures: { countedBy: count.counterNames.join(', '), checkedBy: '' },
	};
}

/** One opening-stock load: what entered the books and at what cost (cost hidden without `stock.cost`). */
export function openingStockData(
	load: OpeningStockRecord,
	titles: ReadonlyMap<string, { title: string; soldBy: 'piece' | 'metre' }>,
	seeCost: boolean,
	seller: DocumentData['seller'],
): DocumentData {
	return {
		doc: 'openingStock',
		title: 'Opening stock',
		number: load.number,
		date: longDate(dayOf(load.postedAt)),
		seller,
		values: { openingNo: load.number, date: longDate(dayOf(load.postedAt)) },
		parties: {},
		rows: load.rows.map((row, at) => {
			const fact = titles.get(row.sku);
			const soldBy = fact?.soldBy ?? 'piece';
			return {
				kind: 'line',
				depth: 0,
				cells: {
					index: String(at + 1),
					item: fact?.title ?? row.sku,
					qty: formatQuantity(row.quantity, soldBy),
					cost: seeCost ? money(soldBy === 'metre' ? row.unitCostINR * 10 : row.unitCostINR) : '',
					value: seeCost ? money(row.quantity * row.unitCostINR) : '',
				},
				sku: row.sku,
			};
		}),
		totals: seeCost ? { totals: [{ label: 'Opening value', value: money(load.totalValueINR) }] } : {},
		signatures: { preparedBy: 'Accounts' },
	};
}
