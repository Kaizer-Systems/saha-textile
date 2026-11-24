import type { CashBox, CashSheet, CashSheetLine, ExpenseClaim, PettyExpense } from '@saha-textile/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { connectMongo, disconnectMongo } from '../src/connection';
import {
	CashBoxModel,
	CashSettingModel,
	CashSheetLineModel,
	CashSheetModel,
	ExpenseClaimModel,
	PettyExpenseModel,
} from '../src/models/cash.model';
import { MongoCashRepository } from '../src/repositories/cash.repository';
import { MongoTransactionManager } from '../src/transaction-manager';

import { hasMongoEnv } from './mongo-test-env';

/**
 * Cash (accounts brief O1–O14) in MongoDB:
 *   node scripts/secrets/test-login.mjs run saha_textile_cash_test -- pnpm --filter @saha-textile/adapters-db-mongo exec vitest run test/cash.persistence.test.ts
 */
describe.skipIf(!hasMongoEnv())('cash boxes, sheets, petty expenses and claims (integration, rs0)', () => {
	const repo = new MongoCashRepository();
	const tx = new MongoTransactionManager();
	const at = '2026-11-23T04:32:00.000Z';
	const wipe = () =>
		Promise.all(
			[
				CashSettingModel,
				CashBoxModel,
				CashSheetModel,
				CashSheetLineModel,
				PettyExpenseModel,
				ExpenseClaimModel,
			].map((m) => m.deleteMany({})),
		);
	const box = (id: string, over: Partial<CashBox> = {}): CashBox => ({
		id,
		name: 'Counter till',
		locationId: 'loc_gariahat',
		kind: 'day_sheet',
		floatPaise: 200_000,
		countedBy: 'cashier',
		reviewedBy: 'location_manager',
		ledgerId: `led_${id}`,
		active: true,
		createdAt: at,
		updatedAt: at,
		...over,
	});
	const count = {
		rows: [{ valuePaise: 50_000, kind: 'note' as const, count: 4 }],
		totalPaise: 200_000,
		at,
		by: null,
	};
	const sheet = (id: string, over: Partial<CashSheet> = {}): CashSheet => ({
		id,
		boxId: 'box_till',
		locationId: 'loc_gariahat',
		date: '2026-11-23',
		status: 'open',
		openedAt: at,
		openedBy: 'adm_priya',
		opening: count,
		openingExpectedPaise: 200_000,
		carried: [],
		counts: [],
		closedAt: null,
		closedBy: null,
		closedLate: false,
		expectedAtClosePaise: null,
		differencePaise: null,
		settlement: null,
		version: 0,
		updatedAt: at,
		...over,
	});
	const line = (id: string, over: Partial<CashSheetLine> = {}): CashSheetLine => ({
		id,
		sheetId: 'sh_23',
		boxId: 'box_till',
		at,
		date: '2026-11-23',
		kind: 'counter_sale',
		what: 'Counter sale',
		ref: 'TI/26-27/000151',
		by: 'adm_priya',
		inPaise: 468_000,
		outPaise: 0,
		voucherId: `jv_${id}`,
		addedOnReview: false,
		...over,
	});
	const petty = (id: string, over: Partial<PettyExpense> = {}): PettyExpense => ({
		id,
		number: `PC/26-27/${id}`,
		boxId: 'box_petty',
		sheetId: null,
		locationId: 'loc_gariahat',
		date: '2026-11-23',
		headLedgerId: 'led_conv',
		headName: 'Local delivery and conveyance',
		amountPaise: 12_000,
		paidTo: 'Bike courier rider',
		whatFor: 'Urgent saree to Jadavpur',
		billMediaId: null,
		gst: null,
		voucherId: `jv_${id}`,
		refillId: null,
		createdAt: at,
		createdBy: 'adm_priya',
		...over,
	});
	const claim = (id: string, over: Partial<ExpenseClaim> = {}): ExpenseClaim => ({
		id,
		number: `EC/26-27/${id}`,
		staffUserId: 'adm_rahul',
		staffName: 'Rahul Das',
		locationId: 'loc_saltlake',
		headLedgerId: 'led_conv',
		headName: 'Local delivery and conveyance',
		amountPaise: 45_000,
		whatFor: 'Auto to Barasat',
		billMediaId: null,
		billName: null,
		spentOn: '2026-11-21',
		status: 'waiting',
		payBack: null,
		payBoxId: null,
		bankLedgerId: null,
		payrollMonth: null,
		decidedAt: null,
		decidedBy: null,
		rejectReason: null,
		approvalVoucherId: null,
		paymentVoucherId: null,
		paidAt: null,
		createdAt: at,
		createdBy: 'adm_rahul',
		version: 0,
		...over,
	});

	beforeAll(async () => {
		await connectMongo();
		await Promise.all(
			[CashBoxModel, CashSheetModel, CashSheetLineModel, PettyExpenseModel, ExpenseClaimModel].map((m) =>
				m.syncIndexes(),
			),
		);
		await wipe();
	});
	afterAll(async () => {
		await wipe();
		await disconnectMongo();
	});

	it('keeps the settings and the boxes, one box per ledger', async () => {
		expect(await repo.settings()).toBeNull();
		await repo.saveSettings({
			denominations: [{ valuePaise: 50_000, kind: 'note', on: true }],
			rules: { billPhotoOverPaise: 50_000, suspenseDays: 30, autoAcceptUpToPaise: 0 },
			updatedAt: at,
		});
		expect((await repo.settings())?.rules.suspenseDays).toBe(30);
		await tx.withTransaction((context) => repo.saveBox(box('box_till'), context));
		await repo.saveBox(box('box_petty', { name: 'Petty cash', kind: 'fixed_float' }));
		await repo.saveBox(box('box_till', { floatPaise: 250_000 }));
		expect((await repo.boxes()).map((b) => [b.name, b.floatPaise])).toEqual([
			['Counter till', 250_000],
			['Petty cash', 200_000],
		]);
		expect((await tx.withTransaction((context) => repo.box('box_petty', context)))?.kind).toBe('fixed_float');
		expect(await repo.box('nothing')).toBeNull();
		await expect(repo.saveBox(box('box_other', { ledgerId: 'led_box_till' }))).rejects.toThrow(
			'duplicate_cash_box_ledger',
		);
	});

	it('keeps one sheet per box and day, at most one open, saved by version', async () => {
		await tx.withTransaction((context) => repo.insertSheet(sheet('sh_22', { date: '2026-11-22' }), context));
		await expect(repo.insertSheet(sheet('sh_22b', { date: '2026-11-22', status: 'closed' }))).rejects.toThrow(
			'cash_sheet_exists',
		);
		await expect(repo.insertSheet(sheet('sh_23b', { date: '2026-11-23' }))).rejects.toThrow('cash_sheet_exists');
		// Anything other than a duplicate goes back as it came.
		await expect(repo.insertSheet({ ...sheet('sh_bad'), boxId: undefined } as never)).rejects.toThrow('boxId');
		const open = await repo.openSheet('box_till');
		expect(open?.id).toBe('sh_22');
		const closed = await tx.withTransaction((context) =>
			repo.saveSheet({ ...open!, status: 'difference', differencePaise: -30_000 }, 0, context),
		);
		expect(closed.version).toBe(1);
		await expect(repo.saveSheet({ ...closed }, 0)).rejects.toThrow('cash_sheet_changed');
		expect(await repo.openSheet('box_till')).toBeNull();
		await repo.insertSheet(
			sheet('sh_23', { carried: [{ sheetId: 'sh_22', date: '2026-11-22', differencePaise: -30_000 }] }),
		);
		expect((await tx.withTransaction((context) => repo.openSheet('box_till', context)))?.id).toBe('sh_23');
		expect((await repo.sheetOn('box_till', '2026-11-22'))?.status).toBe('difference');
		expect(await tx.withTransaction((context) => repo.sheetOn('box_till', '2026-01-01', context))).toBeNull();
		expect((await repo.unsettled('box_till')).map((s) => s.id)).toEqual(['sh_22']);
		expect(await tx.withTransaction((context) => repo.unsettled('box_petty', context))).toEqual([]);
		expect((await repo.sheet('sh_23'))?.carried).toHaveLength(1);
		expect(await tx.withTransaction((context) => repo.sheet('nothing', context))).toBeNull();
	});

	it('lists sheets with every chip’s count, by location and by box or person', async () => {
		await repo.insertSheet(sheet('sh_p23', { boxId: 'box_petty', locationId: 'loc_barasat', status: 'closed' }));
		const query = {
			from: '2026-11-01',
			to: '2026-11-30',
			chip: 'all' as const,
			locationIds: null,
			match: null,
			page: 1,
			pageSize: 25,
		};
		const all = await repo.listSheets(query);
		expect(all.items.map((s) => s.id)).toEqual(['sh_p23', 'sh_23', 'sh_22']);
		expect(all.counts).toEqual({ all: 3, difference: 1, open: 1 });
		const here = await repo.listSheets({ ...query, chip: 'open', locationIds: ['loc_gariahat'] });
		expect(here.items.map((s) => s.id)).toEqual(['sh_23']);
		expect(here.counts.all).toBe(2);
		const byBox = await repo.listSheets({ ...query, match: { boxIds: ['box_petty'], people: null } });
		expect(byBox.items.map((s) => s.id)).toEqual(['sh_p23']);
		const byPerson = await repo.listSheets({ ...query, match: { boxIds: null, people: ['adm_priya'] } });
		expect(byPerson.total).toBe(3);
	});

	it('finds excess due out of suspense, and sheets a month lock must wait for', async () => {
		const settlement = {
			how: 'excess_suspense' as const,
			note: '',
			at,
			by: 'adm_owner',
			voucherId: 'jv_s',
			recount: null,
			ledgerId: null,
			bankLedgerId: null,
			depositSlip: null,
			depositDate: null,
			staffUserId: null,
			staffName: null,
			repayBy: null,
			policeReport: null,
			insured: false,
			noteDetails: null,
			suspenseUntil: '2026-12-23',
			releaseVoucherId: null,
		};
		await repo.insertSheet(sheet('sh_x', { boxId: 'box_x', date: '2026-10-20', status: 'settled', settlement }));
		await repo.insertSheet(
			sheet('sh_y', {
				boxId: 'box_x',
				date: '2026-10-21',
				status: 'settled',
				settlement: { ...settlement, releaseVoucherId: 'jv_r' },
			}),
		);
		expect(await repo.suspenseDue('2026-12-22')).toEqual([]);
		expect((await repo.suspenseDue('2026-12-23')).map((s) => s.id)).toEqual(['sh_x']);
		expect((await repo.unfinishedIn('2026-11')).map((s) => s.id)).toEqual(['sh_22', 'sh_23']);
		expect(await repo.unfinishedIn('2026-10')).toEqual([]);
	});

	it('writes each voucher once per box, adopts lines written between sheets, and totals them', async () => {
		await tx.withTransaction((context) => repo.insertLine(line('l1'), context));
		await repo.insertLine(
			line('l2', { kind: 'petty_expense', inPaise: 0, outPaise: 12_000, at: '2026-11-23T07:45:00.000Z' }),
		);
		await expect(repo.insertLine(line('l1b', { voucherId: 'jv_l1' }))).rejects.toThrow('duplicate_cash_line');
		await repo.insertLine(line('l3', { sheetId: null, boxId: 'box_petty', inPaise: 300_000 }));
		expect((await repo.linesOf('sh_23')).map((l) => l.id)).toEqual(['l1', 'l2']);
		expect(await tx.withTransaction((context) => repo.adoptLines('box_petty', 'sh_p23', context))).toBe(1);
		expect(await repo.adoptLines('box_petty', 'sh_p23')).toBe(0);
		expect((await tx.withTransaction((context) => repo.linesOf('sh_p23', context))).map((l) => l.id)).toEqual([
			'l3',
		]);
		expect(await repo.sheetTotals(['sh_23', 'sh_p23', 'sh_none'])).toEqual({
			sh_23: { inPaise: 468_000, outPaise: 12_000 },
			sh_p23: { inPaise: 300_000, outPaise: 0 },
		});
	});

	it('keeps petty expenses: the day’s cash to a payee, what a refill puts back, and the list', async () => {
		await tx.withTransaction((context) => repo.insertPetty(petty('000412'), context));
		await repo.insertPetty(
			petty('000413', {
				paidTo: '  bike COURIER rider ',
				amountPaise: 8_000,
				headLedgerId: 'led_ref',
				headName: 'Refreshments',
			}),
		);
		await repo.insertPetty(petty('000414', { boxId: 'box_till', date: '2026-11-24' }));
		await expect(repo.insertPetty(petty('000412'))).rejects.toThrow('duplicate_petty_expense');
		expect(await repo.pettyPaidOn('2026-11-23', 'Bike Courier Rider')).toBe(20_000);
		expect(await repo.pettyPaidOn('2026-11-23', 'Somebody')).toBe(0);
		const since = await repo.pettySinceRefill('box_petty');
		expect(since.map((p) => p.number)).toEqual(['PC/26-27/000412', 'PC/26-27/000413']);
		await tx.withTransaction((context) => repo.markRefilled(['000412'], 'rfl_1', context));
		expect(
			(await tx.withTransaction((context) => repo.pettySinceRefill('box_petty', context))).map((p) => p.id),
		).toEqual(['000413']);
		const query = { from: '2026-11-01', to: '2026-11-30', boxIds: null, search: '', page: 1, pageSize: 25 };
		const all = await repo.listPetty(query);
		expect(all.items.map((p) => p.id)).toEqual(['000414', '000413', '000412']);
		expect(all.totalPaise).toBe(32_000);
		const found = await repo.listPetty({ ...query, boxIds: ['box_petty'], search: 'refresh' });
		expect(found).toMatchObject({ total: 1, totalPaise: 8_000 });
		expect(await repo.listPetty({ ...query, from: '2027-01-01', to: '2027-01-31' })).toEqual({
			items: [],
			total: 0,
			totalPaise: 0,
		});
	});

	it('keeps claims by version, lists them by status, and finds those for a month’s payroll', async () => {
		await tx.withTransaction((context) => repo.insertClaim(claim('000017'), context));
		await repo.insertClaim(
			claim('000018', {
				status: 'approved',
				payBack: 'salary',
				payrollMonth: '2026-11',
				staffName: 'Meera Sharma',
				locationId: 'loc_gariahat',
			}),
		);
		await expect(repo.insertClaim(claim('000017'))).rejects.toThrow('duplicate_expense_claim');
		const one = await repo.claim('000017');
		const saved = await tx.withTransaction((context) =>
			repo.saveClaim({ ...one!, status: 'rejected' }, 0, context),
		);
		expect(saved.version).toBe(1);
		await expect(repo.saveClaim(saved, 0)).rejects.toThrow('expense_claim_changed');
		expect(await tx.withTransaction((context) => repo.claim('nothing', context))).toBeNull();
		const query = {
			from: '2026-11-01',
			to: '2026-11-30',
			chip: 'all' as const,
			search: '',
			locationIds: null,
			page: 1,
			pageSize: 25,
		};
		const all = await repo.listClaims(query);
		expect(all.counts).toEqual({ all: 2, waiting: 0, approved: 1, paid: 0, rejected: 1 });
		const meera = await repo.listClaims({
			...query,
			search: 'meera',
			locationIds: ['loc_gariahat'],
			chip: 'approved',
		});
		expect(meera.items.map((c) => c.id)).toEqual(['000018']);
		expect((await repo.claimsForPayroll('2026-11')).map((c) => c.id)).toEqual(['000018']);
		expect(await repo.claimsForPayroll('2026-12')).toEqual([]);
	});
});
