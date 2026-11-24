import { describe, expect, it } from 'vitest';

import {
	Settlement,
	SettlementImportWrite,
	SettlementKind,
	SettlementList,
	SettlementListQuery,
	SettlementPreview,
	SettlementRow,
	SettlementRowWrite,
} from '../src/settlements';

/** Settlements (accounts brief Q10, D27): gateway payout files and couriers' cash-on-delivery remittances. */

const row = {
	payoutReference: 'UTR2611240001',
	date: '2026-11-24',
	reference: 'ST-2611-482190',
	grossPaise: 1_250_000,
};

const saved = {
	id: 'stl_1',
	kind: 'gateway',
	provider: 'CCAvenue',
	payoutReference: 'UTR2611240001',
	date: '2026-11-24',
	bankAccountId: 'ba_hdfc',
	rows: [
		{
			reference: 'ST-2611-482190',
			grossPaise: 1_250_000,
			chargesPaise: 25_000,
			gstPaise: 4_500,
			orderId: 'ord_1',
			orderNumber: 'ST-2611-482190',
			paymentId: 'pay_1',
		},
	],
	grossPaise: 1_250_000,
	chargesPaise: 25_000,
	gstPaise: 4_500,
	netPaise: 1_220_500,
	matched: 1,
	voucherId: 'vch_41',
	fileName: 'ccavenue-payout-24-nov.csv',
	createdAt: '2026-11-24T10:00:00.000Z',
	createdBy: 'adm_1',
};

const accepted = (input: unknown) => expect(input).toBe(true);
const refused = (input: unknown) => expect(input).toBe(false);

describe('payout files', () => {
	it('knows a gateway payout and a courier’s cash-on-delivery remittance, nothing else', () => {
		expect(SettlementKind.options).toEqual(['gateway', 'cod']);
		refused(SettlementKind.safeParse('upi').success);
	});

	it('reads a row with no charges or GST as none, its references trimmed', () => {
		expect(
			SettlementRowWrite.parse({ ...row, payoutReference: '  UTR2611240001 ', reference: ' ST-2611-482190  ' }),
		).toEqual({ ...row, chargesPaise: 0, gstPaise: 0 });
		expect(SettlementRowWrite.parse({ ...row, chargesPaise: 25_000, gstPaise: 4_500 })).toMatchObject({
			chargesPaise: 25_000,
			gstPaise: 4_500,
		});
	});

	it('refuses a row without its references, with references too long, a date in the wrong shape, or money that is not whole paise', () => {
		refused(SettlementRowWrite.safeParse({ ...row, payoutReference: '   ' }).success);
		refused(SettlementRowWrite.safeParse({ ...row, payoutReference: 'x'.repeat(81) }).success);
		accepted(SettlementRowWrite.safeParse({ ...row, payoutReference: 'x'.repeat(80) }).success);
		refused(SettlementRowWrite.safeParse({ ...row, reference: '' }).success);
		refused(SettlementRowWrite.safeParse({ ...row, reference: 'x'.repeat(121) }).success);
		accepted(SettlementRowWrite.safeParse({ ...row, reference: 'x'.repeat(120) }).success);
		refused(SettlementRowWrite.safeParse({ ...row, date: '24/11/2026' }).success);
		refused(SettlementRowWrite.safeParse({ ...row, grossPaise: -1 }).success);
		refused(SettlementRowWrite.safeParse({ ...row, grossPaise: 12.5 }).success);
		refused(SettlementRowWrite.safeParse({ ...row, chargesPaise: -1 }).success);
		refused(SettlementRowWrite.safeParse({ ...row, gstPaise: 0.5 }).success);
	});

	it('imports a file of 1 to 5000 rows from a named provider into a bank account, the file name optional', () => {
		const file = { kind: 'cod', provider: '  Shiprocket ', bankAccountId: 'ba_hdfc', rows: [row] };
		expect(SettlementImportWrite.parse(file)).toEqual({
			kind: 'cod',
			provider: 'Shiprocket',
			bankAccountId: 'ba_hdfc',
			fileName: '',
			rows: [{ ...row, chargesPaise: 0, gstPaise: 0 }],
		});
		expect(SettlementImportWrite.parse({ ...file, fileName: ' cod-nov.csv ' }).fileName).toBe('cod-nov.csv');
		accepted(SettlementImportWrite.safeParse({ ...file, rows: Array.from({ length: 5000 }, () => row) }).success);
		refused(SettlementImportWrite.safeParse({ ...file, rows: Array.from({ length: 5001 }, () => row) }).success);
		refused(SettlementImportWrite.safeParse({ ...file, rows: [] }).success);
	});

	it('refuses an import of an unknown kind, a provider name under 2 or over 40 letters, no bank account, or a long file name', () => {
		const file = { kind: 'gateway', provider: 'CCAvenue', bankAccountId: 'ba_hdfc', rows: [row] };
		refused(SettlementImportWrite.safeParse({ ...file, kind: 'upi' }).success);
		refused(SettlementImportWrite.safeParse({ ...file, provider: ' C ' }).success);
		refused(SettlementImportWrite.safeParse({ ...file, provider: 'x'.repeat(41) }).success);
		accepted(SettlementImportWrite.safeParse({ ...file, provider: 'x'.repeat(40) }).success);
		refused(SettlementImportWrite.safeParse({ ...file, bankAccountId: '' }).success);
		refused(SettlementImportWrite.safeParse({ ...file, fileName: 'x'.repeat(201) }).success);
		refused(SettlementImportWrite.safeParse({ ...file, rows: [{ ...row, grossPaise: -1 }] }).success);
	});
});

describe('saved payouts', () => {
	it('keeps each row with the order payment it pays, or none when it matched nothing', () => {
		expect(SettlementRow.parse(saved.rows[0])).toEqual(saved.rows[0]);
		const loose = { reference: 'pay_xyz', grossPaise: 100, orderId: null, orderNumber: null, paymentId: null };
		expect(SettlementRow.parse(loose)).toEqual({ ...loose, chargesPaise: 0, gstPaise: 0 });
		refused(SettlementRow.safeParse({ ...loose, orderId: undefined }).success);
		refused(SettlementRow.safeParse({ ...loose, paymentId: '' }).success);
	});

	it('drops the payout’s reference and date from each saved row, which the payout holds once', () => {
		expect(
			SettlementRow.parse({ ...saved.rows[0], payoutReference: 'UTR1', date: '2026-11-24' }),
		).not.toHaveProperty('payoutReference');
		expect(SettlementRow.parse({ ...saved.rows[0], date: '2026-11-24' })).not.toHaveProperty('date');
	});

	it('keeps a payout with its totals, how many rows matched, its voucher and who imported it', () => {
		expect(Settlement.parse(saved)).toEqual(saved);
		expect(Settlement.parse({ ...saved, voucherId: null, createdBy: null })).toMatchObject({
			voucherId: null,
			createdBy: null,
		});
		expect(Settlement.parse({ ...saved, netPaise: -5_000 }).netPaise).toBe(-5_000);
		refused(Settlement.safeParse({ ...saved, matched: -1 }).success);
		refused(Settlement.safeParse({ ...saved, netPaise: 0.5 }).success);
		refused(Settlement.safeParse({ ...saved, kind: 'upi' }).success);
		refused(Settlement.safeParse({ ...saved, createdAt: '' }).success);
		refused(Settlement.safeParse({ ...saved, date: '2026-11' }).success);
		refused(Settlement.safeParse({ ...saved, fileName: undefined }).success);
	});

	it('previews each payout of a file with its rows and totals, and whether it was imported already', () => {
		const {
			id: _id,
			kind: _kind,
			provider: _provider,
			bankAccountId: _bank,
			voucherId: _voucher,
			fileName: _file,
			createdAt: _at,
			createdBy: _by,
			...payout
		} = saved;
		const preview = SettlementPreview.parse({ payouts: [{ ...payout, already: true, id: 'ignored' }] });
		expect(preview.payouts[0]).toEqual({ ...payout, already: true });
		expect(SettlementPreview.parse({ payouts: [] }).payouts).toEqual([]);
		refused(SettlementPreview.safeParse({ payouts: [payout] }).success);
		refused(SettlementPreview.safeParse({ payouts: [{ ...payout, already: true, matched: undefined }] }).success);
	});
});

describe('the settlements list', () => {
	it('opens on gateway payouts for a period, page 1 of 20, reading the page from the address', () => {
		expect(SettlementListQuery.parse({ from: '2026-11-01', to: '2026-11-30' })).toEqual({
			kind: 'gateway',
			from: '2026-11-01',
			to: '2026-11-30',
			page: 1,
			pageSize: 20,
		});
		expect(
			SettlementListQuery.parse({
				kind: 'cod',
				from: '2026-11-01',
				to: '2026-11-30',
				page: '3',
				pageSize: '100',
			}),
		).toMatchObject({ kind: 'cod', page: 3, pageSize: 100 });
	});

	it('refuses a page under 1, a page size over 100, a part page, an unknown kind or a missing date', () => {
		const query = { from: '2026-11-01', to: '2026-11-30' };
		refused(SettlementListQuery.safeParse({ ...query, page: '0' }).success);
		refused(SettlementListQuery.safeParse({ ...query, pageSize: '101' }).success);
		refused(SettlementListQuery.safeParse({ ...query, pageSize: '0' }).success);
		refused(SettlementListQuery.safeParse({ ...query, page: '1.5' }).success);
		refused(SettlementListQuery.safeParse({ ...query, page: 'two' }).success);
		refused(SettlementListQuery.safeParse({ ...query, kind: 'upi' }).success);
		refused(SettlementListQuery.safeParse({ from: '2026-11-01' }).success);
	});

	it('lists payouts with the total, a count for both kinds, and gateway payments no payout has paid after 7 days', () => {
		const unsettled = {
			paymentId: 'pay_9',
			orderId: 'ord_9',
			gateway: 'ccavenue',
			reference: null,
			receivedOn: '2026-11-10',
			amountINR: 1_499.5,
		};
		const list = { items: [saved], total: 1, counts: { gateway: 1, cod: 0 }, unsettled: [unsettled] };
		expect(SettlementList.parse(list)).toEqual(list);
		expect(
			SettlementList.parse({ ...list, unsettled: [{ ...unsettled, reference: 'CCA123' }] }).unsettled[0]
				?.reference,
		).toBe('CCA123');
		refused(SettlementList.safeParse({ ...list, counts: { gateway: 1 } }).success);
		refused(SettlementList.safeParse({ ...list, counts: { gateway: 1, cod: 0, upi: 0 } }).success);
		refused(SettlementList.safeParse({ ...list, total: -1 }).success);
		refused(SettlementList.safeParse({ ...list, unsettled: [{ ...unsettled, receivedOn: '10/11/2026' }] }).success);
		refused(SettlementList.safeParse({ ...list, unsettled: [{ ...unsettled, orderId: '' }] }).success);
	});
});
