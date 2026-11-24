import {
	ACCOUNTS_LIST_CHIPS,
	DAY_BOOK_CHIPS,
	type AccountsListPage,
	type AccountsListQuery,
	type AccountsListRow,
	type AccountsListTab,
	type DayBookChip,
} from '@saha-textile/contracts';
import type { AccountsListsReader } from '@saha-textile/core-domain';

import { COLLECTION_NAMES } from '../collection-names';
import { LedgerEntryModel, PaymentModel } from '../models/orders-build.model';
import { JournalVoucherModel, TaxInvoiceModel, VoucherDraftModel } from '../models/ledger.model';
import { OrderModel } from '../models/order.model';
import { PurchaseInvoiceModel, StockAdjustmentModel, SupplierModel } from '../models/purchasing.model';
import { LocationModel } from '../models/locations.model';
import { CreditNoteModel, DebitNoteModel, RefundVoucherModel } from '../models/returns.model';
import { PaymentVoucherModel, SelfInvoiceModel } from '../models/self-invoices.model';

/**
 * Accounts › Vouchers and the Day book (accounts brief A1–A9, A3) over the documents' own collections. Each source is
 * one collection (or one kind in it) feeding one tab: its period, its chips, what search looks in, its date for the
 * sort, and how a stored document becomes a row. A tab of several sources, and the Day book, page through them
 * together with `$unionWith`, sorted by date in the database.
 */

type Doc = Record<string, unknown> & { _id: string };
type Filter = Record<string, unknown>;
/**
 * What the reader asks of a collection: the driver's own calls, because Mongoose would drop filter fields the loose
 * schemas don't declare (receipt numbers, methods…) and read too much.
 */
interface ReadModel {
	collection: {
		aggregate<T>(pipeline: unknown[]): { toArray(): Promise<T[]> };
		countDocuments(filter: Filter): Promise<number>;
		find(
			filter: Filter,
			options: { projection: Record<string, 1>; sort?: Record<string, 1> },
		): { toArray(): Promise<unknown[]> };
	};
}

interface Lookups {
	orders: Map<string, { number: string; buyer: string | null }>;
	businesses: Map<string, string>;
	locations: Map<string, string>;
	/** Orders a business receipt settled, by receipt number. */
	settled: Map<string, string[]>;
}

interface Source {
	key: string;
	tab: AccountsListTab;
	/** The Day book chip it falls under; sales and purchase bills are not vouchers and stay out of the Day book. */
	day?: Exclude<DayBookChip, 'all'>;
	/** Stages before the match, for what the document itself doesn't keep (its order's channel, credit notes). */
	pre?: unknown[];
	model: ReadModel;
	collection: string;
	/** The period, and which documents of the collection this source is. */
	match: (from: string, to: string) => Filter;
	/** Per tab chip; a chip left out takes nothing from this source. */
	chips: Record<string, Filter>;
	/** Only vouchers made (no drafts, no requests waiting) go in the Day book. */
	made?: Filter;
	search: string[];
	/** The India day it is dated, as YYYY-MM-DD. */
	date: unknown;
	row: (doc: Doc, lookups: Lookups) => Omit<AccountsListRow, 'id' | 'tab'>;
}

const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** The UTC instants an India day range runs between, for fields kept as date-times. */
const istStart = (day: string): string => new Date(`${day}T00:00:00+05:30`).toISOString();
const istEnd = (day: string): string =>
	new Date(new Date(`${day}T00:00:00+05:30`).getTime() + 86_400_000).toISOString();
const between = (field: string, from: string, to: string): Filter => ({ [field]: { $gte: from, $lte: to } });
const instants = (field: string, from: string, to: string): Filter => ({
	[field]: { $gte: istStart(from), $lt: istEnd(to) },
});
const istDayOf = (instant: unknown) => ({
	$dateToString: { date: { $toDate: instant }, format: '%Y-%m-%d', timezone: 'Asia/Kolkata' },
});
const ITC = /input tax|s\.17\(5\)\(h\)/i;

const text = (value: unknown): string | null => (typeof value === 'string' && value ? value : null);
const num = (value: unknown): number | null => (typeof value === 'number' ? value : null);
const field = (doc: Doc, path: string): unknown =>
	path.split('.').reduce<unknown>((at, key) => (at as Record<string, unknown> | null)?.[key] ?? null, doc);
const dayOfInstant = (iso: unknown): string =>
	new Date(new Date(String(iso)).getTime() + 5.5 * 3_600_000).toISOString().slice(0, 10);

const blank = {
	number: null,
	party: null,
	against: null,
	detail: null,
	reference: null,
	amountINR: null,
	moneyInINR: null,
	moneyOutINR: null,
	stock: null,
	soldBy: null,
	by: null,
	approvedBy: null,
	extra: {},
} satisfies Omit<AccountsListRow, 'id' | 'tab' | 'date' | 'status'>;

/** A voucher made in Accounts › Vouchers (receipt, payment, contra or journal). */
const voucherRow = (doc: Doc): Omit<AccountsListRow, 'id' | 'tab'> => {
	const amount = Number(doc['totalPaise']) / 100;
	const source = doc['source'] as { type?: string; number?: string | null } | null;
	return {
		...blank,
		number: text(doc['number']),
		date: String(doc['date']),
		against: text(source?.number),
		detail: doc['reversalOfId']
			? 'reversal'
			: ITC.test(String(doc['narration'] ?? ''))
				? 'itc_reversed'
				: String(doc['kind']),
		reference: text(doc['narration']),
		amountINR: amount,
		moneyInINR: doc['kind'] === 'receipt' ? amount : null,
		moneyOutINR: doc['kind'] === 'receipt' || doc['kind'] === 'contra' ? null : amount,
		by: text(doc['createdBy']),
		status: 'posted',
		extra: { sourceType: text(source?.type) },
	};
};
const vouchersOfKind = (kind: string, tab: AccountsListTab, day: Source['day']): Source => ({
	key: `voucher_${kind}`,
	tab,
	day,
	model: JournalVoucherModel as unknown as ReadModel,
	collection: COLLECTION_NAMES.JournalVoucher,
	match: (from, to) => ({ kind, ...between('date', from, to) }),
	chips: { all: {} },
	search: ['number', 'narration'],
	date: '$date',
	row: voucherRow,
});

/** A voucher saved by hand and not yet posted: no number, in its own kind's tab, opening its form (A1). */
const draftsOfKind = (kind: string, tab: AccountsListTab): Source => ({
	key: `draft_${kind}`,
	tab,
	model: VoucherDraftModel as unknown as ReadModel,
	collection: COLLECTION_NAMES.VoucherDraft,
	match: (from, to) => ({ kind, ...between('date', from, to) }),
	chips: { all: {} },
	search: ['narration'],
	date: '$date',
	row: (doc) => {
		const lines = (doc['lines'] as Array<{ debitPaise?: number }> | undefined) ?? [];
		return {
			...blank,
			date: String(doc['date']),
			detail: kind,
			reference: text(doc['narration']),
			amountINR: lines.reduce((sum, line) => sum + (line.debitPaise ?? 0), 0) / 100,
			by: text(doc['createdBy']),
			status: 'draft',
			extra: { draft: 'voucher' },
		};
	},
});

const SOURCES: readonly Source[] = [
	{
		key: 'payment',
		tab: 'receipts',
		day: 'receipts',
		model: PaymentModel as unknown as ReadModel,
		collection: COLLECTION_NAMES.Payment,
		match: (from, to) => ({
			receiptNumber: { $ne: null },
			method: { $ne: 'onAccount' },
			...between('receivedOn', from, to),
		}),
		chips: { all: {}, against_orders: {}, refunded: { state: { $in: ['refunded', 'partRefunded'] } } },
		search: ['receiptNumber', 'reference'],
		date: '$receivedOn',
		row: (doc, { orders }) => {
			const order = orders.get(String(doc['orderId']));
			const state = String(doc['state']);
			return {
				...blank,
				number: text(doc['receiptNumber']),
				date: String(doc['receivedOn']),
				party: order?.buyer ?? null,
				against: order?.number ?? null,
				detail: String(doc['method']),
				reference: text(doc['reference']) ?? text(field(doc, 'gateway.reference')),
				amountINR: num(doc['amountINR']),
				moneyInINR: num(doc['amountINR']),
				by: text(doc['recordedBy']),
				status: state === 'refunded' ? 'refunded' : state === 'partRefunded' ? 'part_refunded' : 'issued',
				extra: { orderId: text(doc['orderId']) },
			};
		},
	},
	{
		key: 'businessReceipt',
		tab: 'receipts',
		day: 'receipts',
		model: LedgerEntryModel as unknown as ReadModel,
		collection: COLLECTION_NAMES.LedgerEntry,
		match: (from, to) => ({ kind: 'receipt', documentNumber: { $ne: null }, ...instants('at', from, to) }),
		chips: { all: {}, on_account: {} },
		search: ['documentNumber', 'note'],
		date: istDayOf('$at'),
		row: (doc, { businesses, settled }) => {
			const orders = settled.get(String(doc['documentNumber'])) ?? [];
			const amount = Math.abs(Number(doc['amountINR']));
			return {
				...blank,
				number: text(doc['documentNumber']),
				date: dayOfInstant(doc['at']),
				party: businesses.get(String(doc['businessId'])) ?? null,
				against: orders.length ? orders.join(', ') : null,
				detail: 'on_account',
				reference: text(doc['note']),
				amountINR: amount,
				moneyInINR: amount,
				by: text(doc['by']),
				status: 'issued',
				extra: { businessId: text(doc['businessId']) },
			};
		},
	},
	vouchersOfKind('receipt', 'receipts', 'receipts'),
	draftsOfKind('receipt', 'receipts'),
	{
		key: 'paymentVoucher',
		tab: 'paymentVouchers',
		day: 'payments',
		model: PaymentVoucherModel as unknown as ReadModel,
		collection: COLLECTION_NAMES.PaymentVoucher,
		match: (from, to) => between('date', from, to),
		chips: {
			all: {},
			reverse_charge: { 'against.kind': 'selfInvoice' },
			supplier_bills: { 'against.kind': 'purchaseEntry' },
			cancelled: { status: 'cancelled' },
		},
		made: { status: 'paid' },
		search: ['number', 'payeeName', 'reference', 'against.number'],
		date: '$date',
		row: (doc) => ({
			...blank,
			number: text(doc['number']),
			date: String(doc['date']),
			party: text(doc['payeeName']),
			against: text(field(doc, 'against.number')),
			detail: String(doc['mode']),
			reference: text(doc['reference']),
			amountINR: num(doc['amountINR']),
			moneyOutINR: num(doc['amountINR']),
			by: text(doc['createdBy']),
			status: String(doc['status']),
			extra: {
				againstKind: text(field(doc, 'against.kind')),
				againstId: text(field(doc, 'against.id')),
				reverseChargeTaxINR: num(doc['reverseChargeTaxINR']),
			},
		}),
	},
	vouchersOfKind('payment', 'paymentVouchers', 'payments'),
	draftsOfKind('payment', 'paymentVouchers'),
	vouchersOfKind('contra', 'contra', 'journals'),
	draftsOfKind('contra', 'contra'),
	draftsOfKind('journal', 'journal'),
	{
		key: 'journal',
		tab: 'journal',
		day: 'journals',
		model: JournalVoucherModel as unknown as ReadModel,
		collection: COLLECTION_NAMES.JournalVoucher,
		match: (from, to) => ({
			...between('date', from, to),
			$or: [{ kind: 'journal' }, { reversalOfId: { $ne: null } }, { narration: ITC }],
		}),
		chips: { all: {}, reversals: { reversalOfId: { $ne: null } }, itc_reversed: { narration: ITC } },
		search: ['number', 'narration', 'source.number'],
		date: '$date',
		row: voucherRow,
	},
	{
		key: 'setOff',
		tab: 'journal',
		day: 'journals',
		model: LedgerEntryModel as unknown as ReadModel,
		collection: COLLECTION_NAMES.LedgerEntry,
		// A set-off is two entries (what we owe and what is owed to us): the receivable side stands for it.
		match: (from, to) => ({
			kind: { $in: ['setOff', 'reversal'] },
			side: 'receivable',
			documentNumber: { $ne: null },
			...instants('at', from, to),
		}),
		chips: { all: {}, set_offs: { kind: 'setOff' }, reversals: { kind: 'reversal' } },
		search: ['documentNumber', 'note'],
		date: istDayOf('$at'),
		row: (doc, { businesses }) => ({
			...blank,
			number: text(doc['documentNumber']),
			date: dayOfInstant(doc['at']),
			party: businesses.get(String(doc['businessId'])) ?? null,
			detail: doc['kind'] === 'setOff' ? 'set_off' : 'set_off_reversed',
			reference: text(doc['note']),
			amountINR: Math.abs(Number(doc['amountINR'])),
			by: text(doc['by']),
			status: 'posted',
			extra: { businessId: text(doc['businessId']) },
		}),
	},
	{
		key: 'creditNote',
		tab: 'creditNotes',
		day: 'creditNotes',
		model: CreditNoteModel as unknown as ReadModel,
		collection: COLLECTION_NAMES.CreditNote,
		match: (from, to) => between('date', from, to),
		chips: {
			all: {},
			drafts: { status: 'draft' },
			waiting_for_buyer: { status: 'issued', 'refund.status': 'due' },
			issued: { status: 'issued' },
			cancelled: { status: 'cancelled' },
		},
		made: { status: { $ne: 'draft' } },
		search: ['number', 'invoiceNumber', 'orderNumber', 'buyer.name'],
		date: '$date',
		row: (doc) => {
			const lines = (doc['lines'] as Array<{ quantity?: number }> | undefined) ?? [];
			const pieces = lines.reduce((sum, line) => sum + (line.quantity ?? 0), 0);
			const waiting = doc['status'] === 'issued' && field(doc, 'refund.status') === 'due';
			return {
				...blank,
				number: text(doc['number']),
				date: String(doc['date']),
				party: text(field(doc, 'buyer.name')),
				against: text(doc['invoiceNumber']),
				detail: String(doc['kind']),
				reference: text(doc['reason']),
				amountINR: num(doc['totalINR']),
				moneyOutINR: num(doc['totalINR']),
				stock: doc['kind'] === 'return' && pieces ? pieces : null,
				by: text(doc['issuedBy']) ?? text(doc['createdBy']),
				status: waiting ? 'waiting_for_buyer' : String(doc['status']),
				extra: {
					orderNumber: text(doc['orderNumber']),
					orderId: text(doc['orderId']),
					taxableINR: num(doc['taxableINR']),
				},
			};
		},
	},
	{
		key: 'debitNote',
		tab: 'debitNotes',
		day: 'creditNotes',
		model: DebitNoteModel as unknown as ReadModel,
		collection: COLLECTION_NAMES.DebitNote,
		match: (from, to) => between('date', from, to),
		chips: { all: {} },
		search: ['number', 'creditNoteNumber', 'orderNumber', 'buyer.name'],
		date: '$date',
		row: (doc) => ({
			...blank,
			number: text(doc['number']),
			date: String(doc['date']),
			party: text(field(doc, 'buyer.name')),
			against: text(doc['creditNoteNumber']),
			reference: text(doc['reason']),
			amountINR: num(doc['totalINR']),
			moneyInINR: num(doc['totalINR']),
			by: text(doc['createdBy']),
			status: 'issued',
			extra: { orderNumber: text(doc['orderNumber']), invoiceNumber: text(doc['invoiceNumber']) },
		}),
	},
	{
		key: 'refundVoucher',
		tab: 'refundVouchers',
		day: 'refunds',
		model: RefundVoucherModel as unknown as ReadModel,
		collection: COLLECTION_NAMES.RefundVoucher,
		match: (from, to) => between('date', from, to),
		chips: {
			all: {},
			refunded: { status: 'refunded' },
			waiting_for_gateway: { status: 'waiting_for_gateway' },
			failed: { status: 'failed' },
		},
		search: ['number', 'receiptNumber', 'orderNumber', 'payee'],
		date: '$date',
		row: (doc) => ({
			...blank,
			number: text(doc['number']),
			date: String(doc['date']),
			party: text(doc['payee']),
			against: text(doc['receiptNumber']),
			detail: String(doc['reason']),
			reference: text(doc['reference']),
			amountINR: num(doc['amountINR']),
			moneyOutINR: num(doc['amountINR']),
			by: text(doc['createdBy']),
			status: String(doc['status']),
			extra: { orderNumber: text(doc['orderNumber']), orderId: text(doc['orderId']), how: text(doc['how']) },
		}),
	},
	{
		key: 'selfInvoice',
		tab: 'selfInvoices',
		day: 'selfInvoices',
		model: SelfInvoiceModel as unknown as ReadModel,
		collection: COLLECTION_NAMES.SelfInvoice,
		match: (from, to) => ({
			$or: [between('date', from, to), { date: null, ...between('receivedOn', from, to) }],
		}),
		chips: {
			all: {},
			drafts: { status: 'draft' },
			unpaid: { status: 'issued', $expr: { $lt: ['$paidINR', '$totalINR'] } },
			paid: { status: 'issued', $expr: { $gte: ['$paidINR', '$totalINR'] } },
		},
		made: { status: { $ne: 'draft' } },
		search: ['number', 'supplierName', 'rule.name'],
		date: { $ifNull: ['$date', '$receivedOn'] },
		row: (doc) => ({
			...blank,
			number: text(doc['number']),
			date: String(doc['date'] ?? doc['receivedOn']),
			party: text(doc['supplierName']),
			against: text(field(doc, 'rule.name')),
			detail: text(doc['forMonth']),
			amountINR: num(doc['totalINR']),
			by: text(doc['issuedBy']) ?? text(doc['createdBy']),
			status: String(doc['status']),
			extra: { taxINR: num(doc['taxINR']), paidINR: num(doc['paidINR']), receivedOn: text(doc['receivedOn']) },
		}),
	},
	{
		key: 'stockAdjustment',
		tab: 'stockAdjustments',
		day: 'stockAdjustments',
		model: StockAdjustmentModel as unknown as ReadModel,
		collection: COLLECTION_NAMES.StockAdjustment,
		match: (from, to) => ({
			kind: 'adjustment',
			action: { $in: ['remove', 'add'] },
			$or: [instants('decidedAt', from, to), { decidedAt: null, ...instants('requestedAt', from, to) }],
		}),
		chips: {
			all: {},
			waiting: { status: 'pending' },
			posted: { status: 'applied', reversedBy: null },
			reversed: { reversedBy: { $ne: null } },
		},
		made: { status: 'applied' },
		search: ['number', 'sku', 'title', 'note'],
		// One waiting for approval has no decision yet: it is dated when it was asked for.
		date: istDayOf({ $ifNull: ['$decidedAt', '$requestedAt'] }),
		row: (doc) => {
			const change = (doc['action'] === 'remove' ? -1 : 1) * Number(doc['quantity']);
			return {
				...blank,
				number: text(doc['number']),
				date: dayOfInstant(doc['decidedAt'] ?? doc['requestedAt']),
				party: null,
				against: text(doc['title']),
				detail: text(doc['reasonCode']),
				reference: text(doc['sku']),
				amountINR: num(doc['valueAtCostINR']),
				stock: change,
				soldBy: doc['soldBy'] === 'metre' ? 'metre' : 'piece',
				by: text(doc['requestedBy']),
				approvedBy: doc['selfApproved'] ? null : text(doc['decidedBy']),
				status: doc['reversedBy'] ? 'reversed' : doc['status'] === 'applied' ? 'posted' : String(doc['status']),
				extra: {
					outcome: text(doc['outcome']),
					itcReversedINR: num(doc['itcReversedINR']),
					journalNumber: text(doc['journalNumber']),
					reverses: text(doc['reverses']),
					requestedByName: text(doc['requestedByName']),
					decidedByName: text(doc['decidedByName']),
				},
			};
		},
	},
	{
		key: 'taxInvoice',
		tab: 'taxInvoices',
		model: TaxInvoiceModel as unknown as ReadModel,
		collection: COLLECTION_NAMES.TaxInvoice,
		pre: [
			{
				$lookup: {
					from: COLLECTION_NAMES.Order,
					localField: 'orderId',
					foreignField: '_id',
					as: 'order',
					pipeline: [{ $project: { channel: 1, eInvoice: 1, eWayBill: 1 } }],
				},
			},
			{ $set: { order: { $first: '$order' } } },
			{
				$lookup: {
					from: COLLECTION_NAMES.CreditNote,
					localField: '_id',
					foreignField: 'invoiceId',
					as: 'credited',
					pipeline: [{ $match: { status: 'issued' } }, { $project: { totalINR: 1 } }],
				},
			},
			{ $set: { creditedINR: { $sum: '$credited.totalINR' } } },
		],
		match: (from, to) => between('date', from, to),
		chips: {
			all: {},
			online: { 'order.channel': 'shop' },
			staff_orders: { 'order.channel': 'admin' },
			counter: { 'order.channel': 'counter' },
			business: { 'buyer.gstin': { $ne: null } },
		},
		search: ['number', 'orderNumber', 'buyer.name', 'buyer.gstin'],
		date: '$date',
		row: (doc, { locations }) => {
			const total = Number(doc['totalINR']);
			// The lookup above always sets it (0 when no credit note is issued against the invoice).
			const credited = Number(doc['creditedINR']);
			const tax = Number(doc['cgstINR']) + Number(doc['sgstINR']) + Number(doc['igstINR']);
			const status =
				doc['status'] === 'cancelled'
					? 'cancelled'
					: credited >= total && credited > 0
						? 'credited'
						: credited > 0
							? 'part_credited'
							: 'issued';
			return {
				...blank,
				number: text(doc['number']),
				date: String(doc['date']),
				party: text(field(doc, 'buyer.name')),
				against: text(doc['orderNumber']),
				detail: text(field(doc, 'order.channel')),
				reference: text(field(doc, 'buyer.gstin')),
				amountINR: total,
				by: text(doc['createdBy']),
				status,
				extra: {
					orderId: text(doc['orderId']),
					location: locations.get(String(doc['locationId'])) ?? null,
					taxableINR: num(doc['taxableINR']),
					taxINR: Math.round(tax * 100) / 100,
					irn: text(field(doc, 'order.eInvoice.irn')),
					eWayBill: text(field(doc, 'order.eWayBill.number')),
				},
			};
		},
	},
	{
		key: 'purchaseBill',
		tab: 'purchaseBills',
		model: PurchaseInvoiceModel as unknown as ReadModel,
		collection: COLLECTION_NAMES.PurchaseInvoice,
		match: (from, to) => ({ status: { $in: ['posted', 'void'] }, ...between('billDate', from, to) }),
		chips: { all: {}, posted: { status: 'posted' }, void: { status: 'void' } },
		search: ['number', 'billNumber', 'supplierName', 'supplierGstin'],
		date: '$billDate',
		row: (doc) => {
			const tax =
				Number(field(doc, 'totals.cgstINR') ?? 0) +
				Number(field(doc, 'totals.sgstINR') ?? 0) +
				Number(field(doc, 'totals.igstINR') ?? 0);
			return {
				...blank,
				number: text(doc['number']),
				date: String(doc['billDate']),
				party: text(doc['supplierName']),
				against: text(doc['billNumber']),
				reference: text(doc['supplierGstin']),
				amountINR: num(field(doc, 'totals.totalINR')),
				by: text(doc['postedBy']),
				status: doc['status'] === 'void' ? 'cancelled' : 'posted',
				extra: {
					location: null,
					taxableINR: num(field(doc, 'totals.taxableINR')),
					taxINR: Math.round(tax * 100) / 100,
					irn: null,
					eWayBill: null,
				},
			};
		},
	},
];

export class MongoAccountsListsReader implements AccountsListsReader {
	async list(tab: AccountsListTab, query: AccountsListQuery, today: string): Promise<AccountsListPage> {
		const sources = SOURCES.filter((source) => source.tab === tab);
		const chips = ACCOUNTS_LIST_CHIPS[tab];
		const filterFor = (source: Source, chip: string): Filter | null => {
			const chosen = chip === 'due_soon' ? this.dueSoon(today) : source.chips[chip];
			if (!chosen) return null;
			const parts = [source.match(query.from, query.to), chosen, this.searchOf(source, query.search)];
			if (tab === 'stockAdjustments' && query.reason) parts.push({ reasonCode: query.reason });
			if (tab === 'taxInvoices' && query.location) parts.push({ locationId: query.location });
			return { $and: parts.filter((part) => Object.keys(part).length) };
		};
		const [page, counts, totals] = await Promise.all([
			this.page(
				sources.flatMap((source) => {
					const filter = filterFor(source, query.chip);
					return filter ? [{ source, filter }] : [];
				}),
				query,
			),
			this.counts(chips, (chip) =>
				sources.flatMap((source) => {
					const filter = filterFor(source, chip);
					return filter ? [{ source, filter }] : [];
				}),
			),
			tab === 'creditNotes' ? this.creditNoteTotals(query) : Promise.resolve({}),
		]);
		return { ...page, total: counts[query.chip] ?? 0, counts, totals };
	}

	async dayBook(query: AccountsListQuery): Promise<AccountsListPage> {
		const filterFor = (source: Source): Filter => ({
			$and: [source.match(query.from, query.to), source.made ?? {}, this.searchOf(source, query.search)].filter(
				(part) => Object.keys(part).length,
			),
		});
		const within = (chip: string) =>
			SOURCES.filter((source) => source.day && (chip === 'all' || source.day === chip)).map((source) => ({
				source,
				filter: filterFor(source),
			}));
		const [page, counts] = await Promise.all([
			this.page(within(query.chip), query),
			this.counts(DAY_BOOK_CHIPS, within),
		]);
		return { ...page, total: counts[query.chip] ?? 0, counts, totals: {} };
	}

	/** Self-invoices waiting to be issued with five days or less of their 30 left (A7, Rule 47A). */
	private dueSoon(today: string): Filter {
		const by = new Date(`${today}T00:00:00Z`);
		by.setUTCDate(by.getUTCDate() - 25);
		return { status: 'draft', receivedOn: { $lte: by.toISOString().slice(0, 10) } };
	}

	private searchOf(source: Source, search: string): Filter {
		if (!search) return {};
		const pattern = new RegExp(escapeRegex(search), 'i');
		return { $or: source.search.map((path) => ({ [path]: pattern })) };
	}

	/** One page across every source, newest first, then each document read and made a row. */
	private async page(
		parts: readonly { source: Source; filter: Filter }[],
		query: AccountsListQuery,
	): Promise<Pick<AccountsListPage, 'items'>> {
		if (!parts.length) return { items: [] };
		const [first, ...rest] = parts as [{ source: Source; filter: Filter }, ...{ source: Source; filter: Filter }[]];
		// Each document comes back whole with its date and source, so nothing is read twice.
		const stage = (part: { source: Source; filter: Filter }, index: number) => [
			...(part.source.pre ?? []),
			{ $match: part.filter },
			{ $project: { d: part.source.date, s: { $literal: index }, doc: '$$ROOT' } },
		];
		const found = await first.source.model.collection
			.aggregate<{ s: number; doc: Doc }>([
				...stage(first, 0),
				...rest.map((part, index) => ({
					$unionWith: { coll: part.source.collection, pipeline: stage(part, index + 1) },
				})),
				{ $sort: { d: -1, _id: -1 } },
				{ $skip: (query.page - 1) * query.pageSize },
				{ $limit: query.pageSize },
			])
			.toArray();
		const lookups = await this.lookups(found.map((entry) => entry.doc));
		return {
			items: found.map(({ s: index, doc }) => {
				const source = (parts[index] as (typeof parts)[number]).source;
				return { id: String(doc._id), tab: source.tab, ...source.row(doc, lookups) };
			}),
		};
	}

	private async counts(
		chips: readonly string[],
		partsOf: (chip: string) => readonly { source: Source; filter: Filter }[],
	): Promise<Record<string, number>> {
		const entries = await Promise.all(
			chips.map(async (chip) => {
				const each = await Promise.all(
					partsOf(chip).map((part) =>
						part.source.pre
							? part.source.model.collection
									.aggregate<{ n: number }>([
										...part.source.pre,
										{ $match: part.filter },
										{ $count: 'n' },
									])
									.toArray()
									.then(([counted]) => counted?.n ?? 0)
							: part.source.model.collection.countDocuments(part.filter),
					),
				);
				return [chip, each.reduce((sum, count) => sum + count, 0)] as const;
			}),
		);
		return Object.fromEntries(entries);
	}

	/** A1's line: what was issued in the period, its tax reversed, and how many. */
	private async creditNoteTotals(query: AccountsListQuery): Promise<Record<string, number>> {
		const [sum] = await (CreditNoteModel as unknown as ReadModel).collection
			.aggregate<{ taxableINR: number; taxINR: number; count: number }>([
				{ $match: { status: 'issued', ...between('date', query.from, query.to) } },
				{
					$group: {
						_id: null,
						taxableINR: { $sum: '$taxableINR' },
						taxINR: { $sum: { $add: ['$cgstINR', '$sgstINR', '$igstINR'] } },
						count: { $sum: 1 },
					},
				},
			])
			.toArray();
		return {
			taxableINR: Math.round((sum?.taxableINR ?? 0) * 100) / 100,
			taxINR: Math.round((sum?.taxINR ?? 0) * 100) / 100,
			count: sum?.count ?? 0,
		};
	}

	/** Order numbers and buyers, business and location names, and the orders each business receipt settled. */
	private async lookups(docs: readonly Doc[]): Promise<Lookups> {
		const orderIds = [
			...new Set(docs.flatMap((doc) => (doc['receiptNumber'] && doc['orderId'] ? [String(doc['orderId'])] : []))),
		];
		const businessIds = [...new Set(docs.flatMap((doc) => (doc['businessId'] ? [String(doc['businessId'])] : [])))];
		const locationIds = [
			...new Set(
				docs.flatMap((doc) => (doc['orderNumber'] && doc['locationId'] ? [String(doc['locationId'])] : [])),
			),
		];
		const receiptNumbers = docs.flatMap((doc) =>
			doc['kind'] === 'receipt' && doc['documentNumber'] ? [String(doc['documentNumber'])] : [],
		);
		const [orders, businesses, settledPayments, locations] = await Promise.all([
			orderIds.length
				? ((OrderModel as unknown as ReadModel).collection
						.find({ _id: { $in: orderIds } }, { projection: { orderNumber: 1, 'buyer.name': 1 } })
						.toArray() as Promise<Doc[]>)
				: [],
			businessIds.length
				? ((SupplierModel as unknown as ReadModel).collection
						.find({ _id: { $in: businessIds } }, { projection: { legalName: 1 } })
						.toArray() as Promise<Doc[]>)
				: [],
			receiptNumbers.length
				? ((PaymentModel as unknown as ReadModel).collection
						.find(
							{ method: 'onAccount', receiptNumber: { $in: receiptNumbers } },
							// In the order they were saved, so a receipt names its orders the same way every time.
							{ projection: { receiptNumber: 1, orderId: 1 }, sort: { _id: 1 } },
						)
						.toArray() as Promise<Doc[]>)
				: [],
			locationIds.length
				? ((LocationModel as unknown as ReadModel).collection
						.find({ _id: { $in: locationIds } }, { projection: { name: 1 } })
						.toArray() as Promise<Doc[]>)
				: [],
		]);
		const settledOrderIds = [...new Set(settledPayments.map((payment) => String(payment['orderId'])))];
		const settledOrders = settledOrderIds.length
			? await ((OrderModel as unknown as ReadModel).collection
					.find({ _id: { $in: settledOrderIds } }, { projection: { orderNumber: 1 } })
					.toArray() as Promise<Doc[]>)
			: [];
		const orderNumber = new Map(settledOrders.map((order) => [String(order._id), String(order['orderNumber'])]));
		const settled = new Map<string, string[]>();
		for (const payment of settledPayments) {
			const key = String(payment['receiptNumber']);
			const number = orderNumber.get(String(payment['orderId']));
			if (number) settled.set(key, [...(settled.get(key) ?? []), number]);
		}
		return {
			orders: new Map(
				orders.map((order) => [
					String(order._id),
					{ number: String(order['orderNumber']), buyer: text(field(order, 'buyer.name')) },
				]),
			),
			businesses: new Map(businesses.map((business) => [String(business._id), String(business['legalName'])])),
			locations: new Map(locations.map((location) => [String(location._id), String(location['name'])])),
			settled,
		};
	}
}
