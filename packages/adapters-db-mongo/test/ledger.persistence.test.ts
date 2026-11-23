import { JournalVoucher, type Ledger } from '@saha-textile/contracts';
import { StaleRevisionError } from '@saha-textile/core-domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { connectMongo, disconnectMongo } from '../src/connection';
import {
	AccountGroupModel,
	DocumentLockModel,
	JournalLineModel,
	JournalVoucherModel,
	LedgerModel,
	PeriodLockModel,
	GstReturnModel,
	TaxInvoiceModel,
	VoucherDraftModel,
} from '../src/models/ledger.model';
import {
	MongoDocumentLockRepository,
	MongoGeneralLedgerRepository,
	MongoGstReturnRepository,
	MongoTaxInvoiceRepository,
	MongoPeriodLockRepository,
} from '../src/repositories/ledger.repository';
import { MongoTransactionManager } from '../src/transaction-manager';

import { hasMongoEnv } from './mongo-test-env';

/**
 * General ledger persistence (accounts brief Q, T, D10) against a real replica set:
 *   node scripts/secrets/test-login.mjs run saha_textile_ledger_test -- pnpm --filter @saha-textile/adapters-db-mongo exec vitest run test/ledger.persistence.test.ts
 */
describe.skipIf(!hasMongoEnv())('general ledger persistence (integration, rs0)', () => {
	const repo = new MongoGeneralLedgerRepository();
	const at = '2026-11-23T10:00:00.000Z';
	const models = [
		AccountGroupModel,
		LedgerModel,
		JournalVoucherModel,
		JournalLineModel,
		PeriodLockModel,
		DocumentLockModel,
		VoucherDraftModel,
		GstReturnModel,
		TaxInvoiceModel,
	];
	const wipe = () => Promise.all(models.map((m) => m.deleteMany({})));
	const ledger = (id: string, systemKey: string | null): Ledger => ({
		id,
		systemKey,
		name: id,
		groupId: 'g_cash',
		nature: 'asset',
		handPosting: true,
		active: true,
		createdAt: at,
		updatedAt: at,
		updatedBy: null,
	});
	const voucher = (id: string, key: string, date: string, amount: number) =>
		JournalVoucher.parse({
			id,
			number: `JV/26-27/${id}`,
			kind: 'journal',
			date,
			narration: 'Rent',
			lines: [
				{ ledgerId: 'rent', locationId: 'loc_bar', gstRegistrationId: 'reg_wb', debitPaise: amount },
				{ ledgerId: 'cash', locationId: 'loc_bar', gstRegistrationId: 'reg_wb', creditPaise: amount },
			],
			idempotencyKey: key,
			totalPaise: amount,
			createdAt: at,
		});

	beforeAll(async () => {
		await connectMongo();
		await Promise.all(models.map((m) => m.syncIndexes()));
		await wipe();
	});
	afterAll(async () => {
		await wipe();
		await disconnectMongo();
	});

	it('seeds the chart once and saves ledgers only over the copy read', async () => {
		const chart = {
			groups: [
				{
					id: 'g_cash',
					systemKey: 'cash_in_hand',
					name: 'Cash in hand',
					parentId: null,
					nature: 'asset' as const,
					tradingAccount: false,
					order: 0,
					createdAt: at,
					updatedAt: at,
				},
			],
			ledgers: [ledger('cash', 'cash'), ledger('rent', null)],
		};
		expect(await repo.seedChart(chart)).toBe(true);
		expect(await repo.seedChart(chart)).toBe(false);
		expect((await repo.chart()).ledgers.map((l) => l.id).sort()).toEqual(['cash', 'rent']);
		const renamed = { ...ledger('rent', null), name: 'Shop rent', updatedAt: '2026-11-23T11:00:00.000Z' };
		await repo.saveLedger(renamed, at);
		await expect(repo.saveLedger({ ...renamed, name: 'Again' }, at)).rejects.toBeInstanceOf(StaleRevisionError);
	});

	it('writes a voucher with its lines in one transaction and refuses a repeated key', async () => {
		const tx = new MongoTransactionManager();
		await tx.withTransaction((context) =>
			repo.insertVoucher(voucher('v1', 'key-one-0001', '2026-11-05', 1_500_000), context),
		);
		expect(await JournalLineModel.countDocuments({ voucherId: 'v1' })).toBe(2);
		expect((await repo.findVoucherByKey('key-one-0001'))?.id).toBe('v1');
		await expect(repo.insertVoucher(voucher('v1b', 'key-one-0001', '2026-11-05', 10))).rejects.toThrow(
			'duplicate_voucher_key',
		);
		// A failed transaction leaves neither the voucher nor its lines.
		await expect(
			tx.withTransaction(async (context) => {
				await repo.insertVoucher(voucher('v9', 'key-nine-0009', '2026-11-06', 500), context);
				throw new Error('document_failed');
			}),
		).rejects.toThrow('document_failed');
		expect(await JournalVoucherModel.exists({ _id: 'v9' })).toBeNull();
		expect(await JournalLineModel.countDocuments({ voucherId: 'v9' })).toBe(0);
	});

	it('reads balances, statement lines, the list and due reversals', async () => {
		await repo.insertVoucher({ ...voucher('v2', 'key-two-0002', '2026-11-20', 250_000), reverseOn: '2026-12-01' });
		expect(await repo.balanceBefore('rent', '2026-11-10', [])).toBe(1_500_000);
		expect(await repo.balanceBefore('cash', '2026-11-30', ['loc_bar'])).toBe(-1_750_000);
		expect(await repo.balanceBefore('cash', '2026-11-30', ['loc_other'])).toBe(0);
		const lines = await repo.statementLines('rent', '2026-11-10', '2026-11-30', []);
		expect(lines.map((l) => [l.number, l.debitPaise])).toEqual([['JV/26-27/v2', 250_000]]);
		const page = await repo.listVouchers({
			from: '2026-11-01',
			to: '2026-11-30',
			kinds: ['journal'],
			search: 'v2',
			page: 1,
			pageSize: 10,
		});
		expect(page.total).toBe(1);
		expect((await repo.dueReversals('2026-12-01')).map((v) => v.id)).toEqual(['v2']);
		await repo.markReversed('v2', 'v2r');
		await expect(repo.markReversed('v2', 'v2r2')).rejects.toThrow('already_reversed');
		expect(await repo.dueReversals('2026-12-01')).toEqual([]);
		expect(await repo.ledgerInUse('rent')).toBe(true);
		expect(await repo.balancesAt('2026-11-30', [])).toEqual({ rent: 1_750_000, cash: -1_750_000 });
	});

	it('keeps one lock per month and part', async () => {
		const locks = new MongoPeriodLockRepository();
		await locks.save([
			{ month: '2026-10', part: 'sales', state: 'closed_for_staff', reason: 'October done', by: 'adm_1', at },
		]);
		await locks.save([
			{ month: '2026-10', part: 'sales', state: 'locked', reason: 'GSTR-1 filed', by: 'adm_1', at },
		]);
		expect(await locks.list()).toMatchObject([{ month: '2026-10', part: 'sales', state: 'locked' }]);
	});

	it('gives a document lock to one person, lets them keep it, and frees it when stale', async () => {
		const locks = new MongoDocumentLockRepository();
		const mine = {
			documentType: 'voucher',
			documentId: 'v1',
			holderId: 'adm_a',
			holderName: 'A',
			since: at,
			lastActiveAt: at,
		};
		expect((await locks.acquire(mine, '2026-11-23T09:00:00.000Z')).holderId).toBe('adm_a');
		const theirs = { ...mine, holderId: 'adm_b', holderName: 'B', lastActiveAt: '2026-11-23T10:00:10.000Z' };
		expect((await locks.acquire(theirs, '2026-11-23T09:59:00.000Z')).holderId).toBe('adm_a');
		expect(await locks.touch('voucher', 'v1', 'adm_b', at)).toBe(false);
		expect((await locks.acquire(theirs, '2026-11-23T10:05:00.000Z')).holderId).toBe('adm_b');
		await locks.release('voucher', 'v1', 'adm_b');
		expect(await locks.get('voucher', 'v1')).toBeNull();
	});

	it('keeps drafts, saves them only over the copy read, and removes them', async () => {
		const draft = {
			id: 'vd_1',
			kind: 'journal' as const,
			date: '2026-11-30',
			narration: 'Electricity accrual',
			lines: [{ ledgerId: 'rent', locationId: '', debitPaise: 840_000, creditPaise: 0, narration: '' }],
			reverseOn: null,
			attachments: [{ assetId: 'ast_1', name: 'cesc-bill-nov.pdf' }],
			createdBy: 'adm_a',
			createdByName: 'A',
			createdAt: at,
			updatedAt: at,
			updatedBy: 'adm_a',
		};
		await repo.saveDraft(draft, null);
		const later = { ...draft, narration: 'Electricity accrual, November', updatedAt: '2026-11-23T11:00:00.000Z' };
		await repo.saveDraft(later, at);
		await expect(repo.saveDraft({ ...later, narration: 'x' }, at)).rejects.toBeInstanceOf(StaleRevisionError);
		expect((await repo.listDrafts()).map((d) => d.narration)).toEqual(['Electricity accrual, November']);
		expect((await repo.getDraft('vd_1'))?.attachments[0]?.name).toBe('cesc-bill-nov.pdf');
		await repo.deleteDraft('vd_1');
		expect(await repo.getDraft('vd_1')).toBeNull();
	});

	it('records a GST return as filed once per GSTIN, return and month', async () => {
		const gst = new MongoGstReturnRepository();
		const filing = {
			gstRegistrationId: 'reg_wb',
			gstin: '19DBYPS6736R1ZZ',
			returnType: 'GSTR-3B' as const,
			month: '2026-10',
			arn: 'AA1911261234567',
			filedOn: '2026-11-20',
			acknowledgement: null,
			by: 'adm_a',
			at,
		};
		await gst.insert(filing);
		await expect(gst.insert(filing)).rejects.toThrow('duplicate_gst_filing');
		expect(await gst.list()).toMatchObject([{ arn: 'AA1911261234567', month: '2026-10' }]);
	});

	it('keeps tax invoice numbers unique per GSTIN, one invoice per shipment, and cancels once', async () => {
		const invoices = new MongoTaxInvoiceRepository();
		const party = { name: 'K.R. Marketing', gstin: '19DBYPS6736R1ZZ', address: 'Barasat', stateCode: '19' };
		const invoice = {
			id: 'ti_1',
			number: 'TI/26-27/000001',
			date: '2026-11-23',
			gstRegistrationId: 'reg_wb',
			gstin: '19DBYPS6736R1ZZ',
			locationId: 'loc_bar',
			orderId: 'ord_1',
			orderNumber: 'ST-2611-000001',
			shipmentId: 'shp_1',
			seller: party,
			buyer: { ...party, name: 'Rang Mahal', gstin: null, stateCode: '27' },
			placeOfSupply: '27',
			interState: true,
			lines: [
				{
					lineId: 'a',
					sku: 'S',
					title: 'Saree',
					hsn: '5007',
					quantity: 1,
					unit: 'PCS' as const,
					unitPriceINR: 105,
					ratePercent: 5,
					taxableINR: 100,
					cgstINR: 0,
					sgstINR: 0,
					igstINR: 5,
					totalINR: 105,
				},
			],
			shippingINR: 0,
			taxableINR: 100,
			cgstINR: 0,
			sgstINR: 0,
			igstINR: 5,
			roundOffINR: 0,
			totalINR: 105,
			ratesPendingCa: true,
			status: 'issued' as const,
			cancellation: null,
			voucherId: null,
			createdBy: null,
			createdAt: at,
		};
		await invoices.insert(invoice);
		await expect(invoices.insert({ ...invoice, id: 'ti_2', shipmentId: 'shp_2' })).rejects.toThrow(
			'duplicate_tax_invoice',
		);
		await expect(invoices.insert({ ...invoice, id: 'ti_3', number: 'TI/26-27/000002' })).rejects.toThrow(
			'duplicate_tax_invoice',
		);
		// The same number under another GSTIN is a different series.
		await invoices.insert({ ...invoice, id: 'ti_4', gstin: '16ABCDE1234F1Z5', shipmentId: 'shp_4' });
		expect((await invoices.listForOrder('ord_1')).map((i) => i.id)).toEqual(['ti_1', 'ti_4']);
		expect((await invoices.findByShipment('shp_1'))?.number).toBe('TI/26-27/000001');
		await invoices.cancel('ti_1', { at, by: 'adm_a', reason: 'Wrong buyer' });
		await expect(invoices.cancel('ti_1', { at, by: 'adm_a', reason: 'Again' })).rejects.toThrow(
			'invoice_not_cancellable',
		);
		expect(
			(await invoices.list({ from: '2026-11-01', to: '2026-11-30', search: 'rang', page: 1, pageSize: 10 }))
				.total,
		).toBe(2);
		// Issued before dispatch (for its e-way bill), several may wait without a parcel; each is tied to one once.
		await invoices.insert({ ...invoice, id: 'ti_5', number: 'TI/26-27/000005', shipmentId: null });
		await invoices.insert({ ...invoice, id: 'ti_6', number: 'TI/26-27/000006', shipmentId: null });
		await invoices.linkShipment('ti_5', 'shp_5');
		expect((await invoices.findByShipment('shp_5'))?.id).toBe('ti_5');
		await expect(invoices.linkShipment('ti_5', 'shp_6')).rejects.toThrow('invoice_already_linked');
	});
});
