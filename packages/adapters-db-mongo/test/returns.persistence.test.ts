import { CreditNote, DebitNote, OrderReturn } from '@saha-textile/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { connectMongo, disconnectMongo } from '../src/connection';
import { CreditNoteModel, DebitNoteModel, OrderReturnModel } from '../src/models/returns.model';
import {
	MongoCreditNoteRepository,
	MongoDebitNoteRepository,
	MongoOrderReturnRepository,
} from '../src/repositories/returns.repository';
import { MongoTransactionManager } from '../src/transaction-manager';

import { hasMongoEnv } from './mongo-test-env';

/**
 * Returns, credit notes and debit notes (accounts brief B) against a real replica set:
 *   node scripts/secrets/test-login.mjs run saha_textile_returns_test -- pnpm --filter @saha-textile/adapters-db-mongo exec vitest run test/returns.persistence.test.ts
 */
describe.skipIf(!hasMongoEnv())('returns and notes persistence (integration, rs0)', () => {
	const at = '2026-11-25T10:00:00.000Z';
	const models = [OrderReturnModel, CreditNoteModel, DebitNoteModel];
	const party = { name: 'Ananya Das', gstin: null, address: 'Kolkata', stateCode: '19' };
	const line = {
		lineId: 'a',
		sku: 'BAN-3',
		title: 'Banarasi Silk Saree',
		hsn: '5007',
		quantity: 1,
		unitPriceINR: 4_680,
		ratePercent: 5,
		taxableINR: 4_457.14,
		cgstINR: 111.43,
		sgstINR: 111.43,
		totalINR: 4_680,
	};
	const ret = OrderReturn.parse({
		id: 'ret_1',
		number: 'ST-2611-482190/R1',
		orderId: 'ord_1',
		orderNumber: 'ST-2611-482190',
		invoiceId: 'ti_1',
		invoiceNumber: 'TI/26-27/000145',
		status: 'asked',
		lines: [{ lineId: 'a', sku: 'BAN-3', title: 'Banarasi', quantity: 1, unitPriceINR: 4_680 }],
		reason: 'damaged_on_arrival',
		how: 'pickup',
		refundTo: 'original_payment',
		createdAt: at,
		updatedAt: at,
	});
	const note = CreditNote.parse({
		id: 'cn_1',
		status: 'draft',
		kind: 'goods_returned',
		date: '2026-11-25',
		invoiceId: 'ti_1',
		invoiceNumber: 'TI/26-27/000145',
		invoiceDate: '2026-11-18',
		gstRegistrationId: 'reg_wb',
		gstin: '19DBYPS6736R1ZZ',
		locationId: 'loc_bar',
		orderId: 'ord_1',
		orderNumber: 'ST-2611-482190',
		returnId: 'ret_1',
		buyer: party,
		placeOfSupply: '19',
		interState: false,
		reason: 'Damaged on arrival',
		refundTo: 'original_payment',
		lines: [line],
		taxableINR: 4_457.14,
		cgstINR: 111.43,
		sgstINR: 111.43,
		igstINR: 0,
		roundOffINR: 0,
		totalINR: 4_680,
		deadline: '2027-11-30',
		createdAt: at,
	});
	const debit = DebitNote.parse({
		id: 'dn_1',
		number: 'DN/26-27/000001',
		date: '2026-12-02',
		gstRegistrationId: 'reg_wb',
		gstin: '19DBYPS6736R1ZZ',
		locationId: 'loc_bar',
		orderId: 'ord_1',
		orderNumber: 'ST-2611-482190',
		invoiceId: 'ti_1',
		invoiceNumber: 'TI/26-27/000145',
		creditNoteId: 'cn_1',
		creditNoteNumber: 'CN/26-27/000012',
		buyer: party,
		placeOfSupply: '19',
		interState: false,
		reason: 'Made against the wrong invoice',
		lines: [line],
		taxableINR: 4_457.14,
		cgstINR: 111.43,
		sgstINR: 111.43,
		igstINR: 0,
		roundOffINR: 0,
		totalINR: 4_680,
		createdAt: at,
	});
	const wipe = () => Promise.all(models.map((m) => m.deleteMany({})));

	beforeAll(async () => {
		await connectMongo();
		await Promise.all(models.map((m) => m.syncIndexes()));
		await wipe();
	});
	afterAll(async () => {
		await wipe();
		await disconnectMongo();
	});

	it('keeps a return, refuses a second with its number, and a save that lost the race', async () => {
		const returns = new MongoOrderReturnRepository();
		await returns.insert(ret);
		await expect(returns.insert({ ...ret, id: 'ret_2' })).rejects.toThrow('duplicate_return');
		const later = '2026-11-25T11:00:00.000Z';
		await returns.save({ ...ret, status: 'received', updatedAt: later }, at);
		await expect(returns.save({ ...ret, status: 'checked' }, at)).rejects.toThrow('return_changed');
		expect((await returns.get('ret_1'))?.status).toBe('received');
		expect(await returns.get('ret_x')).toBeNull();
		expect((await returns.listForOrder('ord_1')).map((r) => r.id)).toEqual(['ret_1']);
		await expect(
			returns.insert({ ...ret, id: 'ret_3', number: 'ST-2611-482190/R3', orderId: undefined as never }),
		).rejects.toThrow();
	});

	it('keeps credit note drafts by version, numbers them once per GSTIN, lists and deletes only drafts', async () => {
		const notes = new MongoCreditNoteRepository();
		const tx = new MongoTransactionManager();
		await tx.withTransaction((context) => notes.insert(note, context));
		const saved = await notes.save({ ...note, reason: 'Zari pulled' }, 0);
		expect(saved.version).toBe(1);
		await expect(notes.save(note, 0)).rejects.toThrow('credit_note_changed');
		const issued = await notes.save({ ...saved, status: 'issued', number: 'CN/26-27/000012' }, 1);
		await notes
			.insert({ ...note, id: 'cn_2', number: 'CN/26-27/000012', status: 'issued' })
			.catch((e: Error) => expect(e.message).toBe('duplicate_credit_note'));
		await notes.insert({ ...note, id: 'cn_3' });
		await expect(notes.save({ ...note, id: 'cn_3', number: 'CN/26-27/000012' }, 0)).rejects.toThrow(
			'duplicate_credit_note',
		);
		expect((await notes.get('cn_1', undefined))?.number).toBe(issued.number);
		expect(await notes.get('cn_x')).toBeNull();
		expect((await notes.listForOrder('ord_1')).length).toBe(2);
		expect((await notes.listForInvoice('ti_1')).length).toBe(2);
		const listed = await notes.list({
			from: '2026-11-01',
			to: '2026-11-30',
			search: '000012',
			status: 'issued',
			page: 1,
			pageSize: 10,
		});
		expect(listed).toMatchObject({ total: 1, items: [{ id: 'cn_1' }] });
		expect(
			(
				await notes.list({
					from: '2026-11-01',
					to: '2026-11-30',
					search: '',
					status: null,
					page: 1,
					pageSize: 10,
				})
			).total,
		).toBe(2);
		await expect(notes.deleteDraft('cn_1')).rejects.toThrow('credit_note_not_draft');
		await notes.deleteDraft('cn_3');
		expect(await notes.get('cn_3')).toBeNull();
	});

	it('keeps debit notes, one number per GSTIN', async () => {
		const debits = new MongoDebitNoteRepository();
		await debits.insert(debit);
		await expect(debits.insert({ ...debit, id: 'dn_2' })).rejects.toThrow('duplicate_debit_note');
		expect((await debits.get('dn_1'))?.creditNoteId).toBe('cn_1');
		expect(await debits.get('dn_x')).toBeNull();
		expect((await debits.listForOrder('ord_1')).map((d) => d.id)).toEqual(['dn_1']);
	});
});
