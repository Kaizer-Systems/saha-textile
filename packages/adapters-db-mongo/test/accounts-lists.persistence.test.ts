import { AccountsListQuery } from '@saha-textile/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { connectMongo, disconnectMongo } from '../src/connection';
import { JournalVoucherModel, TaxInvoiceModel, VoucherDraftModel } from '../src/models/ledger.model';
import { LocationModel } from '../src/models/locations.model';
import { OrderModel } from '../src/models/order.model';
import { LedgerEntryModel, PaymentModel } from '../src/models/orders-build.model';
import { PurchaseInvoiceModel, StockAdjustmentModel, SupplierModel } from '../src/models/purchasing.model';
import { CreditNoteModel, DebitNoteModel, RefundVoucherModel } from '../src/models/returns.model';
import { PaymentVoucherModel, SelfInvoiceModel } from '../src/models/self-invoices.model';
import { MongoAccountsListsReader } from '../src/repositories/accounts-lists.reader';

import { hasMongoEnv, insertRaw } from './mongo-test-env';

/**
 * Accounts › Vouchers and the Day book (accounts brief A1–A9, A3) over every document collection:
 *   node scripts/secrets/test-login.mjs run saha_textile_accounts_lists_test -- pnpm --filter @saha-textile/adapters-db-mongo exec vitest run test/accounts-lists.persistence.test.ts
 */
describe.skipIf(!hasMongoEnv())('accounts lists and the Day book (integration, rs0)', () => {
	const models = [
		PaymentModel,
		OrderModel,
		LedgerEntryModel,
		SupplierModel,
		JournalVoucherModel,
		CreditNoteModel,
		DebitNoteModel,
		RefundVoucherModel,
		PaymentVoucherModel,
		SelfInvoiceModel,
		StockAdjustmentModel,
		TaxInvoiceModel,
		PurchaseInvoiceModel,
		LocationModel,
		VoucherDraftModel,
	];
	const wipe = () => Promise.all(models.map((m) => (m as typeof PaymentModel).deleteMany({})));
	const reader = new MongoAccountsListsReader();
	const nov = (over: Partial<AccountsListQuery> = {}) =>
		AccountsListQuery.parse({ from: '2026-11-01', to: '2026-11-30', ...over });
	const today = '2026-11-24';
	const raw = (model: unknown, doc: Record<string, unknown>) => insertRaw(model as never, doc);
	const payment = (id: string, over: Record<string, unknown>) =>
		raw(PaymentModel, {
			_id: id,
			method: 'upi',
			state: 'received',
			amountINR: 1000,
			recordedAt: '2026-11-01T00:00:00.000Z',
			...over,
		});
	const voucher = (id: string, over: Record<string, unknown>) =>
		raw(JournalVoucherModel, {
			_id: id,
			kind: 'journal',
			date: '2026-11-17',
			totalPaise: 10_000,
			createdBy: 'adm_1',
			...over,
		});
	const entry = (id: string, over: Record<string, unknown>) =>
		raw(LedgerEntryModel, { _id: id, side: 'receivable', businessId: 'biz_1', by: 'adm_1', ...over });
	const adjustment = (id: string, over: Record<string, unknown>) =>
		raw(StockAdjustmentModel, {
			_id: id,
			kind: 'adjustment',
			action: 'remove',
			quantity: 2,
			reasonCode: 'damage',
			sku: 'PTC-CRM-M',
			title: 'Cotton petticoat',
			soldBy: 'piece',
			status: 'applied',
			requestedBy: 'usr_2',
			requestedAt: '2026-11-22T05:00:00.000Z',
			decidedBy: 'adm_1',
			decidedAt: '2026-11-22T06:00:00.000Z',
			selfApproved: false,
			reversedBy: null,
			...over,
		});

	beforeAll(async () => {
		await connectMongo();
		await wipe();
		await Promise.all([
			raw(OrderModel, {
				_id: 'ord_1',
				orderNumber: 'ST-2611-514203',
				channel: 'shop',
				buyer: { name: 'Meera Sharma' },
			}),
			raw(OrderModel, {
				_id: 'ord_2',
				orderNumber: 'ST-2611-688796',
				channel: 'admin',
				buyer: { name: 'Priya Sharma' },
				eInvoice: { irn: 'a'.repeat(64) },
				eWayBill: { number: '123456789012' },
			}),
			raw(OrderModel, { _id: 'ord_3', orderNumber: 'ST-2611-300718' }),
			raw(SupplierModel, { _id: 'biz_1', legalName: 'Boutique Nila' }),
			payment('pay_1', {
				receiptNumber: 'RC/26-27/000014',
				amountINR: 9560,
				reference: '402112345678',
				receivedOn: '2026-11-23',
				orderId: 'ord_1',
				recordedBy: 'usr_staff',
			}),
			payment('pay_2', {
				receiptNumber: 'RC/26-27/000013',
				method: 'gateway',
				state: 'refunded',
				reference: null,
				gateway: { reference: 'pay_Pq81' },
				receivedOn: '2026-11-22',
				orderId: 'ord_2',
			}),
			payment('pay_3', {
				receiptNumber: 'RC/26-27/000011',
				state: 'partRefunded',
				receivedOn: '2026-11-21',
				orderId: 'ord_gone',
			}),
			payment('pay_4', {
				receiptNumber: 'RC/26-27/000012',
				method: 'onAccount',
				receivedOn: '2026-11-22',
				orderId: 'ord_3',
			}),
			payment('pay_7', {
				receiptNumber: 'RC/26-27/000012',
				method: 'onAccount',
				receivedOn: '2026-11-22',
				orderId: 'ord_1',
			}),
			payment('pay_6', {
				receiptNumber: 'RC/26-27/000015',
				method: 'onAccount',
				receivedOn: '2026-11-23',
				orderId: 'ord_lost',
			}),
			payment('pay_5', { receiptNumber: null, state: 'pending', receivedOn: null, orderId: 'ord_1' }),
			entry('le_1', {
				kind: 'receipt',
				documentNumber: 'RC/26-27/000012',
				amountINR: -25_000,
				note: 'NEFT 0098 1123',
				at: '2026-11-22T06:00:00.000Z',
			}),
			entry('le_2', {
				kind: 'receipt',
				documentNumber: 'RC/26-27/000015',
				businessId: 'biz_gone',
				amountINR: -1000,
				at: '2026-11-23T05:00:00.000Z',
			}),
			entry('le_6', {
				kind: 'receipt',
				documentNumber: 'RC/26-27/000016',
				amountINR: -500,
				at: '2026-11-10T05:00:00.000Z',
			}),
			entry('le_3', {
				kind: 'setOff',
				documentNumber: 'JV/26-27/000012',
				amountINR: -12_000,
				at: '2026-11-20T06:00:00.000Z',
			}),
			entry('le_4', {
				kind: 'setOff',
				side: 'payable',
				documentNumber: 'JV/26-27/000012',
				amountINR: -12_000,
				at: '2026-11-20T06:00:00.000Z',
			}),
			entry('le_5', {
				kind: 'reversal',
				documentNumber: 'JV/26-27/000011',
				businessId: 'biz_gone',
				amountINR: 3000,
				at: '2026-11-19T06:00:00.000Z',
			}),
			voucher('jv_r', {
				kind: 'receipt',
				number: 'JV/26-27/000020',
				date: '2026-11-18',
				totalPaise: 50_000,
				narration: 'Cash sale by hand',
				source: null,
			}),
			voucher('jv_p', { kind: 'payment', number: 'JV/26-27/000021', date: '2026-11-18' }),
			voucher('jv_c', {
				kind: 'contra',
				number: 'JV/26-27/000022',
				date: '2026-11-24',
				totalPaise: 441_200,
				narration: 'Cash deposited',
			}),
			voucher('jv_j', { number: 'JV/26-27/000023', narration: 'Accrual' }),
			voucher('jv_itc', {
				kind: 'document',
				number: 'JV/26-27/000013',
				date: '2026-11-22',
				totalPaise: 65_100,
				narration: 'Stock adjustment SA/26-27/0004; input tax reversed, s.17(5)(h)',
				source: { type: 'stockAdjustment', id: 'sa_1', number: 'SA/26-27/0004' },
			}),
			voucher('jv_rev', {
				kind: 'document',
				number: 'JV/26-27/000024',
				date: '2026-11-21',
				reversalOfId: 'jv_x',
				narration: 'Reversal',
			}),
			voucher('jv_doc', {
				kind: 'document',
				number: 'JV/26-27/000030',
				narration: 'Tax invoice TI/26-27/000145',
			}),
			raw(CreditNoteModel, {
				_id: 'cn_1',
				invoiceId: 'ti_1',
				number: 'CN/26-27/000012',
				status: 'issued',
				kind: 'return',
				date: '2026-11-23',
				invoiceNumber: 'TI/26-27/000145',
				orderNumber: 'ST-2611-482190',
				orderId: 'ord_9',
				buyer: { name: 'Ananya Das' },
				reason: 'Return',
				lines: [{ quantity: 1 }],
				taxableINR: 4457.14,
				cgstINR: 111.43,
				sgstINR: 111.43,
				igstINR: 0,
				totalINR: 4680,
				refund: { status: 'paid' },
				issuedBy: 'adm_1',
			}),
			raw(CreditNoteModel, {
				_id: 'cn_2',
				invoiceId: 'ti_2',
				number: 'CN/26-27/000011',
				status: 'issued',
				kind: 'priceAdjustment',
				date: '2026-11-21',
				buyer: { name: 'Boutique Nila' },
				lines: [{ quantity: 1 }],
				taxableINR: 1000,
				cgstINR: 25,
				sgstINR: 25,
				igstINR: 0,
				totalINR: 1050,
				refund: { status: 'due' },
				createdBy: 'adm_2',
			}),
			raw(CreditNoteModel, {
				_id: 'cn_3',
				number: null,
				status: 'draft',
				kind: 'return',
				date: '2026-11-20',
				createdBy: 'adm_1',
			}),
			raw(CreditNoteModel, {
				_id: 'cn_4',
				number: 'CN/26-27/000008',
				status: 'cancelled',
				kind: 'return',
				date: '2026-11-11',
				lines: [],
				totalINR: 900,
			}),
			raw(CreditNoteModel, {
				_id: 'cn_5',
				number: 'CN/26-27/000009',
				status: 'issued',
				kind: 'return',
				date: '2026-11-12',
				lines: [{}],
				taxableINR: 100,
				cgstINR: 2.5,
				sgstINR: 2.5,
				igstINR: 0,
				totalINR: 105,
			}),
			raw(DebitNoteModel, {
				_id: 'dn_1',
				number: 'DN/26-27/000001',
				date: '2026-11-21',
				creditNoteNumber: 'CN/26-27/000008',
				buyer: { name: 'Kabir Sharma' },
				totalINR: 500,
				createdBy: 'adm_1',
			}),
			raw(RefundVoucherModel, {
				_id: 'rf_1',
				paymentId: 'pay_for_rf_1',
				number: 'RF/26-27/000003',
				date: '2026-11-22',
				payee: 'Priya Sharma',
				receiptNumber: 'RC/26-27/000013',
				orderNumber: 'ST-2611-688796',
				reason: 'order_cancelled',
				how: 'gateway',
				amountINR: 2600,
				status: 'refunded',
			}),
			raw(RefundVoucherModel, {
				_id: 'rf_2',
				paymentId: 'pay_for_rf_2',
				number: 'RF/26-27/000002',
				date: '2026-11-19',
				payee: 'Anjali',
				amountINR: 1850,
				status: 'waiting_for_gateway',
			}),
			raw(RefundVoucherModel, {
				_id: 'rf_3',
				paymentId: 'pay_for_rf_3',
				number: 'RF/26-27/000001',
				date: '2026-11-12',
				payee: 'Rohan',
				amountINR: 5800,
				status: 'failed',
			}),
			raw(PaymentVoucherModel, {
				_id: 'pv_1',
				number: 'PV/26-27/000007',
				date: '2026-11-21',
				payeeName: 'Bose Properties',
				against: { kind: 'selfInvoice', id: 'si_1', number: 'SI/26-27/000002' },
				amountINR: 60_000,
				mode: 'bank_transfer',
				reference: 'UTR1',
				reverseChargeTaxINR: 10_800,
				status: 'paid',
				createdBy: 'adm_1',
			}),
			raw(PaymentVoucherModel, {
				_id: 'pv_2',
				number: 'PV/26-27/000006',
				date: '2026-11-20',
				payeeName: 'Weaver',
				against: { kind: 'purchaseEntry', id: 'pe_1', number: 'PE/26-27/000014' },
				amountINR: 1000,
				mode: 'cash',
				reference: null,
				reverseChargeTaxINR: null,
				status: 'cancelled',
			}),
			raw(SelfInvoiceModel, {
				_id: 'si_1',
				number: 'SI/26-27/000002',
				status: 'issued',
				date: '2026-11-21',
				receivedOn: '2026-11-01',
				supplierName: 'Bose Properties',
				rule: { name: 'Shop rent' },
				forMonth: '2026-11',
				totalINR: 70_800,
				taxINR: 10_800,
				paidINR: 70_800,
				issuedBy: 'adm_1',
			}),
			raw(SelfInvoiceModel, {
				_id: 'si_2',
				number: null,
				status: 'draft',
				date: null,
				receivedOn: '2026-11-03',
				supplierName: 'Mitra & Co.',
				totalINR: 1180,
				paidINR: 0,
				createdBy: 'adm_1',
			}),
			raw(SelfInvoiceModel, {
				_id: 'si_3',
				number: 'SI/26-27/000001',
				status: 'issued',
				date: '2026-11-15',
				receivedOn: '2026-11-10',
				supplierName: 'GTA',
				totalINR: 1050,
				paidINR: 0,
			}),
			adjustment('sa_1', {
				number: 'SA/26-27/0004',
				valueAtCostINR: 620,
				itcReversedINR: 31,
				journalNumber: 'JV/26-27/000013',
				outcome: 'writtenOff',
			}),
			adjustment('sa_2', {
				number: 'SA/26-27/0003',
				action: 'add',
				quantity: 25,
				soldBy: 'metre',
				reasonCode: 'manual_recount_correction',
				selfApproved: true,
				decidedAt: '2026-11-18T06:00:00.000Z',
				reverses: 'sa_x',
			}),
			adjustment('sa_3', {
				status: 'pending',
				quantity: 1,
				reasonCode: 'lost_missing',
				decidedAt: null,
				decidedBy: null,
				requestedAt: '2026-11-20T05:00:00.000Z',
			}),
			adjustment('sa_4', { number: 'SA/26-27/0001', decidedAt: '2026-11-18T05:00:00.000Z', reversedBy: 'sa_2' }),
			adjustment('sa_5', { kind: 'count' }),
			raw(LocationModel, { _id: 'loc_gar', name: 'Gariahat' }),
			raw(VoucherDraftModel, {
				_id: 'vd_1',
				kind: 'journal',
				date: '2026-11-16',
				narration: 'Accrual draft',
				lines: [{ debitPaise: 25_000 }, { creditPaise: 25_000 }],
				createdBy: 'adm_1',
			}),
			raw(VoucherDraftModel, {
				_id: 'vd_2',
				kind: 'contra',
				date: '2026-11-25',
				narration: 'Deposit',
				createdBy: 'adm_1',
			}),
			raw(TaxInvoiceModel, {
				_id: 'ti_1',
				number: 'TI/26-27/000145',
				date: '2026-11-18',
				orderId: 'ord_1',
				orderNumber: 'ST-2611-514203',
				locationId: 'loc_gar',
				buyer: { name: 'Ananya Das', gstin: null },
				taxableINR: 4457.14,
				cgstINR: 111.43,
				sgstINR: 111.43,
				igstINR: 0,
				totalINR: 4680,
				status: 'issued',
				createdBy: 'adm_1',
			}),
			raw(TaxInvoiceModel, {
				_id: 'ti_2',
				number: 'TI/26-27/000149',
				date: '2026-11-22',
				orderId: 'ord_2',
				orderNumber: 'ST-2611-688796',
				locationId: 'loc_gone',
				buyer: { name: 'Boutique Nila', gstin: '19AABCB1234A1Z5' },
				taxableINR: 9523.81,
				cgstINR: 0,
				sgstINR: 0,
				igstINR: 476.19,
				totalINR: 10_000,
				status: 'issued',
			}),
			raw(TaxInvoiceModel, {
				_id: 'ti_3',
				number: 'TI/26-27/000150',
				date: '2026-11-23',
				orderId: 'ord_gone',
				orderNumber: 'ST-X',
				locationId: 'loc_gar',
				buyer: { name: 'Shreya Ghosh', gstin: null },
				taxableINR: 590.52,
				cgstINR: 14.76,
				sgstINR: 14.76,
				igstINR: 0,
				totalINR: 620,
				status: 'cancelled',
			}),
			raw(TaxInvoiceModel, {
				_id: 'ti_4',
				number: 'TI/26-27/000151',
				date: '2026-11-24',
				orderId: 'ord_3',
				orderNumber: 'ST-2611-300718',
				locationId: 'loc_gar',
				buyer: { name: 'Shreya Ghosh', gstin: null },
				taxableINR: 100,
				cgstINR: 2.5,
				sgstINR: 2.5,
				igstINR: 0,
				totalINR: 105,
				status: 'issued',
			}),
			raw(PurchaseInvoiceModel, {
				_id: 'pe_1',
				supplierId: 'sup_pe_1',
				billNumberKey: 'key_pe_1',
				number: 'PE/26-27/000014',
				status: 'posted',
				supplierName: 'Weavers Co-op',
				supplierGstin: '19AAACW1111A1Z1',
				billNumber: 'WC/881',
				billDate: '2026-11-10',
				totals: { taxableINR: 46_095.24, cgstINR: 1152.38, sgstINR: 1152.38, igstINR: 0, totalINR: 48_400 },
				postedBy: 'adm_1',
			}),
			raw(PurchaseInvoiceModel, {
				_id: 'pe_2',
				supplierId: 'sup_pe_2',
				billNumberKey: 'key_pe_2',
				number: 'PE/26-27/000013',
				status: 'void',
				supplierName: 'Loom House',
				supplierGstin: null,
				billNumber: 'LH/12',
				billDate: '2026-11-08',
				totals: { totalINR: 500 },
			}),
			raw(PurchaseInvoiceModel, {
				_id: 'pe_3',
				supplierId: 'sup_pe_3',
				billNumberKey: 'key_pe_3',
				number: null,
				status: 'draft',
				supplierName: 'Draft Co',
				billNumber: 'D/1',
				billDate: '2026-11-09',
			}),
		]);
	});
	afterAll(async () => {
		await wipe();
		await disconnectMongo();
	});

	it('lists receipts from orders, business accounts and by hand, with their chips', async () => {
		const page = await reader.list('receipts', nov(), today);
		expect(page.counts).toEqual({ all: 7, against_orders: 3, on_account: 3, refunded: 2 });
		expect(page.items.map((row) => row.number)).toEqual([
			'RC/26-27/000014',
			'RC/26-27/000015',
			'RC/26-27/000013',
			'RC/26-27/000012',
			'RC/26-27/000011',
			'JV/26-27/000020',
			'RC/26-27/000016',
		]);
		const [meera, lost, priya, nila, gone, hand] = page.items;
		expect(meera).toMatchObject({
			party: 'Meera Sharma',
			against: 'ST-2611-514203',
			detail: 'upi',
			moneyInINR: 9560,
			by: 'usr_staff',
			status: 'issued',
		});
		expect(lost).toMatchObject({ party: null, against: null, amountINR: 1000, detail: 'on_account' });
		expect(priya).toMatchObject({ reference: 'pay_Pq81', status: 'refunded' });
		expect(nila).toMatchObject({
			party: 'Boutique Nila',
			against: 'ST-2611-300718, ST-2611-514203',
			reference: 'NEFT 0098 1123',
			amountINR: 25_000,
		});
		expect(gone).toMatchObject({ party: null, against: null, status: 'part_refunded' });
		expect(hand).toMatchObject({ moneyInINR: 500, moneyOutINR: null, detail: 'receipt', against: null });
		expect((await reader.list('receipts', nov({ chip: 'refunded' }), today)).items).toHaveLength(2);
		const searched = await reader.list('receipts', nov({ search: 'RC/26-27/000016' }), today);
		expect(searched.items.map((row) => [row.number, row.against])).toEqual([['RC/26-27/000016', null]]);
		expect((await reader.list('receipts', nov({ search: '4021' }), today)).total).toBe(1);
	});

	it('lists payment vouchers, contra and journal vouchers (set-offs, reversals, input tax reversed)', async () => {
		const pay = await reader.list('paymentVouchers', nov(), today);
		expect(pay.counts).toEqual({ all: 3, reverse_charge: 1, supplier_bills: 1, cancelled: 1 });
		expect(pay.items[0]).toMatchObject({
			number: 'PV/26-27/000007',
			against: 'SI/26-27/000002',
			extra: { reverseChargeTaxINR: 10_800, againstKind: 'selfInvoice' },
		});
		expect(pay.items.find((row) => row.id === 'jv_p')).toMatchObject({ moneyOutINR: 100, detail: 'payment' });
		const contra = await reader.list('contra', nov(), today);
		expect(contra.items.map((row) => [row.id, row.number, row.status, row.amountINR])).toEqual([
			['vd_2', null, 'draft', 0],
			['jv_c', 'JV/26-27/000022', 'posted', 4412],
		]);
		expect(contra.items[1]).toMatchObject({ moneyInINR: null, moneyOutINR: null });
		const journal = await reader.list('journal', nov(), today);
		expect(journal.counts).toEqual({ all: 6, set_offs: 1, reversals: 2, itc_reversed: 1 });
		expect(journal.items.find((row) => row.id === 'vd_1')).toMatchObject({
			number: null,
			status: 'draft',
			amountINR: 250,
			reference: 'Accrual draft',
			extra: { draft: 'voucher' },
		});
		expect(journal.items.map((row) => [row.number, row.detail])).toEqual([
			['JV/26-27/000013', 'itc_reversed'],
			['JV/26-27/000024', 'reversal'],
			['JV/26-27/000012', 'set_off'],
			['JV/26-27/000011', 'set_off_reversed'],
			['JV/26-27/000023', 'journal'],
			[null, 'journal'],
		]);
		expect(journal.items[0]).toMatchObject({ against: 'SA/26-27/0004', extra: { sourceType: 'stockAdjustment' } });
		expect(journal.items[2]).toMatchObject({ party: 'Boutique Nila', amountINR: 12_000 });
		expect(journal.items[3]).toMatchObject({ party: null, amountINR: 3000 });
	});

	it('lists credit notes with the period’s totals, debit notes and refund vouchers', async () => {
		const notes = await reader.list('creditNotes', nov(), today);
		expect(notes.counts).toEqual({ all: 5, drafts: 1, waiting_for_buyer: 1, issued: 3, cancelled: 1 });
		expect(notes.totals).toEqual({ taxableINR: 5557.14, taxINR: 277.86, count: 3 });
		const byId = new Map(notes.items.map((row) => [row.id, row]));
		expect(byId.get('cn_1')).toMatchObject({
			stock: 1,
			by: 'adm_1',
			status: 'issued',
			extra: { orderNumber: 'ST-2611-482190', taxableINR: 4457.14 },
		});
		expect(byId.get('cn_2')).toMatchObject({ stock: null, by: 'adm_2', status: 'waiting_for_buyer' });
		expect(byId.get('cn_3')).toMatchObject({ number: null, status: 'draft', stock: null });
		expect(byId.get('cn_5')).toMatchObject({ stock: null });
		expect((await reader.list('creditNotes', nov({ from: '2025-11-01', to: '2025-11-30' }), today)).totals).toEqual(
			{ taxableINR: 0, taxINR: 0, count: 0 },
		);
		const debit = await reader.list('debitNotes', nov(), today);
		expect(debit.items).toEqual([
			expect.objectContaining({
				number: 'DN/26-27/000001',
				party: 'Kabir Sharma',
				against: 'CN/26-27/000008',
				moneyInINR: 500,
			}),
		]);
		expect(await reader.list('debitNotes', nov({ chip: 'nope' }), today)).toEqual({
			items: [],
			total: 0,
			counts: { all: 1 },
			totals: {},
		});
		const refunds = await reader.list('refundVouchers', nov(), today);
		expect(refunds.counts).toEqual({ all: 3, refunded: 1, waiting_for_gateway: 1, failed: 1 });
		expect(refunds.items[0]).toMatchObject({
			party: 'Priya Sharma',
			against: 'RC/26-27/000013',
			detail: 'order_cancelled',
			moneyOutINR: 2600,
			extra: { how: 'gateway' },
		});
	});

	it('lists self-invoices (due soon from today) and stock adjustments by reason', async () => {
		// Five days or less of the 30 left on 30 Nov: the draft received on 3 Nov.
		const self = await reader.list('selfInvoices', nov(), '2026-11-30');
		expect(self.counts).toEqual({ all: 3, drafts: 1, due_soon: 1, unpaid: 1, paid: 1 });
		expect(self.items.find((row) => row.id === 'si_2')).toMatchObject({
			date: '2026-11-03',
			number: null,
			by: 'adm_1',
			status: 'draft',
		});
		expect(self.items.find((row) => row.id === 'si_1')).toMatchObject({
			against: 'Shop rent',
			by: 'adm_1',
			extra: { paidINR: 70_800 },
		});
		const adjustments = await reader.list('stockAdjustments', nov(), today);
		expect(adjustments.counts).toEqual({ all: 4, waiting: 1, posted: 2, reversed: 1 });
		const byId = new Map(adjustments.items.map((row) => [row.id, row]));
		expect(byId.get('sa_1')).toMatchObject({
			date: '2026-11-22',
			stock: -2,
			approvedBy: 'adm_1',
			status: 'posted',
			extra: { itcReversedINR: 31, journalNumber: 'JV/26-27/000013' },
		});
		expect(byId.get('sa_2')).toMatchObject({
			stock: 25,
			soldBy: 'metre',
			approvedBy: null,
			extra: { reverses: 'sa_x' },
		});
		expect(byId.get('sa_3')).toMatchObject({ date: '2026-11-20', number: null, status: 'pending' });
		expect(byId.get('sa_4')).toMatchObject({ status: 'reversed' });
		expect((await reader.list('stockAdjustments', nov({ reason: 'damage' }), today)).total).toBe(2);
	});

	it('lists tax invoices by channel, business and location, credited or not, and posted purchase bills', async () => {
		const sales = await reader.list('taxInvoices', nov(), today);
		expect(sales.counts).toEqual({ all: 4, online: 1, staff_orders: 1, business: 1 });
		const byId = new Map(sales.items.map((row) => [row.id, row]));
		expect(byId.get('ti_1')).toMatchObject({
			status: 'credited',
			detail: 'shop',
			extra: { location: 'Gariahat', taxINR: 222.86, irn: null },
		});
		expect(byId.get('ti_2')).toMatchObject({
			status: 'part_credited',
			reference: '19AABCB1234A1Z5',
			extra: { location: null, irn: 'a'.repeat(64), eWayBill: '123456789012' },
		});
		expect(byId.get('ti_3')).toMatchObject({ status: 'cancelled', detail: null });
		expect(byId.get('ti_4')).toMatchObject({ status: 'issued', by: null });
		expect((await reader.list('taxInvoices', nov({ location: 'loc_gar' }), today)).total).toBe(3);
		expect((await reader.list('taxInvoices', nov({ chip: 'business' }), today)).items.map((row) => row.id)).toEqual(
			['ti_2'],
		);
		const bills = await reader.list('purchaseBills', nov(), today);
		expect(bills.counts).toEqual({ all: 2, posted: 1, void: 1 });
		expect(bills.items).toEqual([
			expect.objectContaining({
				id: 'pe_1',
				against: 'WC/881',
				amountINR: 48_400,
				status: 'posted',
				extra: expect.objectContaining({ taxableINR: 46_095.24, taxINR: 2304.76 }),
			}),
			expect.objectContaining({
				id: 'pe_2',
				status: 'cancelled',
				extra: expect.objectContaining({ taxableINR: null, taxINR: 0 }),
			}),
		]);
	});

	it('writes the Day book: every voucher made, by date, with its chips and search', async () => {
		const day = await reader.dayBook(nov({ pageSize: 5 }));
		expect(day.counts).toEqual({
			all: 28,
			receipts: 7,
			refunds: 3,
			creditNotes: 5,
			payments: 2,
			selfInvoices: 2,
			journals: 6,
			stockAdjustments: 3,
		});
		expect(day.items.map((row) => row.id)).toEqual(['jv_c', 'pay_1', 'le_2', 'cn_1', 'sa_1']);
		expect(day.items[4]).toMatchObject({ tab: 'stockAdjustments', stock: -2 });
		const sa = await reader.dayBook(nov({ chip: 'journals', search: 'SA/26-27/0004' }));
		expect(sa.items.map((row) => row.id)).toEqual(['jv_itc']);
		expect((await reader.dayBook(nov({ search: 'SA/26-27/0004' }))).total).toBe(2);
		expect(await reader.dayBook(nov({ chip: 'nope' }))).toMatchObject({ items: [], total: 0 });
	});
});
