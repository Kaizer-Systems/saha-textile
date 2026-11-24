import type { CashBox, CashSettingsWrite, CashSheet, JournalVoucher } from '@saha-textile/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { cashGroup, groupPlays, isBank, personName, stateOf } from '../src/cash/cash-books';
import { CASH_SWEEP_MS, CashService } from '../src/cash/cash.service';
import { ClaimsService } from '../src/cash/claims.service';
import { PettyService } from '../src/cash/petty.service';
import { AT, MemoryCash, MemoryLedger, cashChart } from './cash-memory';

/** Cash (accounts brief O1–O14) through its services, with the books and storage in memory. */

const DAY = new Date('2026-11-23T05:00:00.000Z');
const NEXT = new Date('2026-11-24T05:00:00.000Z');
const LATER = new Date('2026-12-30T05:00:00.000Z');

const cashier = {
	userId: 'adm_priya',
	sessionId: 's',
	audience: 'admin',
	role: null,
	permissions: ['cash.index', 'cash.count'],
} as never;
const other = {
	userId: 'adm_rahul',
	sessionId: 's',
	audience: 'admin',
	role: null,
	permissions: ['cash.count'],
} as never;
const manager = {
	userId: 'adm_meera',
	sessionId: 's',
	audience: 'admin',
	role: null,
	permissions: ['cash.index', 'cash.count', 'cash.manage'],
} as never;
const owner = { userId: 'adm_owner', sessionId: 's', audience: 'admin', role: null, permissions: [] } as never;
const far = { userId: 'adm_far', sessionId: 's', audience: 'admin', role: null, permissions: ['cash.count'] } as never;

const PEOPLE: Record<string, { id: string; displayName?: string; email?: string }> = {
	adm_priya: { id: 'adm_priya', displayName: 'Priya Sen' },
	adm_rahul: { id: 'adm_rahul', displayName: 'Rahul Das' },
	adm_meera: { id: 'adm_meera', displayName: 'Meera Sharma' },
	adm_owner: { id: 'adm_owner', email: 'owner@saha-textile.test' },
	adm_far: { id: 'adm_far', displayName: 'Far Away' },
};
const PLACES = [
	{ id: 'loc_gar', name: 'Gariahat store', active: true, gstRegistrationId: 'reg_wb' },
	{ id: 'loc_bar', name: 'Barasat warehouse', active: true, gstRegistrationId: null },
	{ id: 'loc_old', name: 'Old shop', active: false, gstRegistrationId: null },
];

/** Notes only: ₹500 × n, ₹100 × m. */
const notes = (five: number, hundred = 0) => ({
	rows: [
		{ valuePaise: 50_000, kind: 'note' as const, count: five },
		{ valuePaise: 10_000, kind: 'note' as const, count: hundred },
	],
});

function setup(options: { limit?: number | null } = {}) {
	const repo = new MemoryCash();
	const ledger = new MemoryLedger();
	const logged: unknown[][] = [];
	const log = { append: async (...args: unknown[]) => void logged.push(args) };
	const admins = {
		findById: async (id: string) => {
			if (id === 'adm_broken') throw new Error('down');
			return PEOPLE[id] ?? null;
		},
		list: async () => ({ items: [...Object.values(PEOPLE), { id: 'adm_blank' }], total: 6 }),
	};
	const places = { list: async () => PLACES };
	const locations = {
		scope: async (principal?: { userId: string }) =>
			principal?.userId === 'adm_far' ? { all: false, ids: ['loc_bar'] } : { all: true, ids: [] },
	};
	const tx = { withTransaction: <T>(work: (context: never) => Promise<T>) => work({} as never) };
	const books = { balanceBefore: async (id: string) => ledger.balance(id) };
	const cash = new CashService(
		repo,
		tx as never,
		admins as never,
		places as never,
		books,
		ledger as never,
		locations as never,
		log as never,
	);
	cash.onModuleInit();
	let n = 0;
	const numbers = {
		issue: async (type: string) => `${type === 'pettyExpense' ? 'PC' : 'EC'}/26-27/${String(++n).padStart(6, '0')}`,
	};
	const templates = { limitOn: async () => (options.limit === undefined ? 10_000 : options.limit) };
	const company = {
		getRegistration: async (id: string) => (id === 'reg_wb' ? { gstin: '19ABCDE1234F1Z5' } : null),
	};
	const media = {
		findManyByIds: async (ids: string[]) =>
			ids.includes('med_bill') ? [{ id: 'med_bill', slug: 'auto-receipt' }] : [],
	};
	const petty = new PettyService(
		repo,
		tx as never,
		places as never,
		company as never,
		cash,
		ledger as never,
		templates as never,
		numbers as never,
		log as never,
	);
	const claims = new ClaimsService(
		repo,
		tx as never,
		places as never,
		media as never,
		cash,
		ledger as never,
		numbers as never,
		log as never,
	);
	return { repo, ledger, logged, cash, petty, claims };
}

const rules = { billPhotoOverPaise: 50_000, suspenseDays: 30, autoAcceptUpToPaise: 0 };
const DENOMS = [
	{ valuePaise: 50_000, kind: 'note' as const, on: true },
	{ valuePaise: 10_000, kind: 'note' as const, on: true },
	{ valuePaise: 200_000, kind: 'note' as const, on: false },
];
const boxWrite = (patch: Partial<CashSettingsWrite['boxes'][number]> = {}) => ({
	name: 'Counter till',
	locationId: 'loc_gar',
	kind: 'day_sheet' as const,
	floatPaise: 200_000,
	countedBy: 'cashier' as const,
	reviewedBy: 'location_manager' as const,
	active: true,
	...patch,
});

/** Settings saved with a till and a petty box at Gariahat, and a till at Barasat reviewed by the owner. */
async function withBoxes(s: ReturnType<typeof setup>, autoAcceptUpToPaise = 0) {
	await s.cash.saveSettings(
		{
			boxes: [
				boxWrite(),
				boxWrite({
					name: 'Petty cash',
					kind: 'fixed_float',
					floatPaise: 500_000,
					countedBy: 'location_manager',
				}),
				boxWrite({ name: 'Barasat till', locationId: 'loc_bar', reviewedBy: 'owner' }),
			],
			denominations: DENOMS,
			rules: { ...rules, autoAcceptUpToPaise },
		},
		'adm_owner',
		DAY,
	);
	const boxes = await s.repo.boxes();
	const named = (name: string) => boxes.find((b) => b.name === name) as CashBox;
	return { till: named('Counter till'), petty: named('Petty cash'), barasat: named('Barasat till') };
}

/** Money into a box as the books would post it (a counter sale stands in). */
const sale = (s: ReturnType<typeof setup>, box: CashBox, paise: number, sourceType = 'counterSale') =>
	s.ledger.post(
		{
			kind: 'receipt',
			date: '2026-11-23',
			narration: 'Counter sale',
			lines: [
				{ ledger: { id: box.ledgerId }, locationId: box.locationId, debitPaise: paise },
				{ ledger: { id: 'led_debtors' }, locationId: box.locationId, creditPaise: paise },
			],
			source: { type: sourceType, id: `s_${paise}`, number: 'TI/26-27/000151' },
			idempotencyKey: `sale:${paise}`,
		},
		{} as never,
		'adm_priya',
	);

describe('Settings › Cash boxes (O1)', () => {
	it('starts from the default notes and rules, and gives each new box its own ledger under Cash in hand', async () => {
		const s = setup();
		expect((await s.cash.settingsView()).settings.rules.suspenseDays).toBe(30);
		const { till, petty } = await withBoxes(s);
		expect(till.ledgerId).not.toBe(petty.ledgerId);
		expect(s.ledger.chartNow.ledgers.find((l) => l.id === till.ledgerId)?.groupId).toBe('g_cash');
		expect((await s.cash.settingsView()).settings.denominations).toHaveLength(3);
		expect(s.logged.at(-1)?.[1]).toBe('cash.settings.save');
	});

	it('renames a box’s ledger with the box, leaves it when nothing changed, and refuses what can’t be saved', async () => {
		const s = setup();
		const { till } = await withBoxes(s);
		const save = (boxes: CashSettingsWrite['boxes'], denominations = DENOMS) =>
			s.cash.saveSettings({ boxes, denominations, rules }, 'adm_owner', DAY);
		await save([{ ...boxWrite({ name: 'Front till' }), id: till.id }]);
		expect(s.ledger.saved).toEqual([[till.ledgerId, 'Front till · Gariahat store', true]]);
		await save([{ ...boxWrite({ name: 'Front till' }), id: till.id }]);
		expect(s.ledger.saved).toHaveLength(1);
		await save([{ ...boxWrite({ name: 'Front till', active: false }), id: till.id }]);
		expect(s.ledger.saved).toHaveLength(2);
		// A box whose ledger is gone from the chart still saves.
		s.ledger.chartNow.ledgers = s.ledger.chartNow.ledgers.filter((l) => l.id !== till.ledgerId);
		await save([{ ...boxWrite({ name: 'Till again' }), id: till.id }]);
		await expect(save([], [{ ...DENOMS[0]!, on: false }])).rejects.toMatchObject({
			response: { message: 'cash_no_denomination_on' },
		});
		await expect(save([boxWrite({ locationId: 'loc_nowhere' })])).rejects.toMatchObject({
			response: { message: 'location_unknown' },
		});
		await expect(save([{ ...boxWrite(), id: 'box_gone' }])).rejects.toMatchObject({
			response: { message: 'cash_box_not_found' },
		});
		await s.cash.open({ boxId: till.id, count: notes(4), carryDifference: false }, cashier, DAY);
		await expect(save([{ ...boxWrite({ locationId: 'loc_bar' }), id: till.id }])).rejects.toMatchObject({
			response: { message: 'cash_box_has_open_sheet' },
		});
		s.ledger.chartNow.groups = s.ledger.chartNow.groups.filter((g) => g.id !== 'g_cash');
		await expect(save([boxWrite({ name: 'New till' })])).rejects.toMatchObject({
			response: { message: 'voucher_problem:role_not_mapped:cash_in_hand' },
		});
	});

	it('moves a box with no open sheet to another location', async () => {
		const s = setup();
		const { petty } = await withBoxes(s);
		await s.cash.saveSettings(
			{
				boxes: [
					{ ...boxWrite({ name: 'Petty cash', kind: 'fixed_float', locationId: 'loc_bar' }), id: petty.id },
				],
				denominations: DENOMS,
				rules,
			},
			null,
			DAY,
		);
		expect((await s.repo.box(petty.id))?.locationId).toBe('loc_bar');
	});
});

describe('today’s sheet: open, lines, close (O2–O7, O14)', () => {
	it('says when a person has no box, or asks for one they can’t reach', async () => {
		const s = setup();
		await expect(s.cash.today(null, cashier, DAY)).rejects.toMatchObject({
			response: { message: 'cash_box_none_here' },
		});
		const { till } = await withBoxes(s);
		await expect(s.cash.today(till.id, far, DAY)).rejects.toMatchObject({
			response: { message: 'location_out_of_scope' },
		});
		await expect(s.cash.today('box_gone', cashier, DAY)).rejects.toMatchObject({
			response: { message: 'cash_box_not_found' },
		});
		// Someone with only a fixed float gets that box.
		const pettyOnly = setup();
		await pettyOnly.cash.saveSettings(
			{ boxes: [boxWrite({ name: 'Petty cash', kind: 'fixed_float' })], denominations: DENOMS, rules },
			null,
			DAY,
		);
		expect((await pettyOnly.cash.today(null, cashier, DAY)).box.name).toBe('Petty cash');
	});

	it('opens by counting the float, writes the books’ lines on the sheet, and hides amounts from the cashier', async () => {
		const s = setup();
		const { till } = await withBoxes(s);
		const before = await s.cash.today(till.id, cashier, DAY);
		expect(before).toMatchObject({
			box: { id: till.id },
			sheet: null,
			stillOpen: null,
			unsettled: [],
			today: '2026-11-23',
		});
		expect(before.denominations.map((d) => d.valuePaise)).toEqual([50_000, 10_000]);
		const opened = await s.cash.open({ boxId: till.id, count: notes(4), carryDifference: false }, cashier, DAY);
		expect(opened.sheet.opening.totalPaise).toBe(200_000);
		expect(opened.sheet.openingExpectedPaise).toBe(0);
		await sale(s, till, 468_000);
		const seen = await s.cash.view(opened.sheet.id, cashier);
		expect(seen.amounts).toBe(false);
		expect(seen.expectedPaise).toBeNull();
		expect(seen.rows.map((r) => [r.kind, r.by, r.inPaise])).toEqual([
			['opening', 'Priya Sen', null],
			['counter_sale', 'Priya Sen', null],
		]);
		const managed = await s.cash.view(opened.sheet.id, manager);
		expect(managed.expectedPaise).toBe(468_000);
		expect(managed.rows.at(-1)?.expectedPaise).toBe(468_000);
		expect(managed.locationName).toBe('Gariahat store');
		expect((await s.cash.today(till.id, cashier, DAY)).sheet?.sheet.id).toBe(opened.sheet.id);
	});

	it('refuses a switched-off box, a second sheet, an unknown note, and a sheet of another location', async () => {
		const s = setup();
		const { till, barasat } = await withBoxes(s);
		await s.repo.saveBox({ ...till, active: false });
		await expect(
			s.cash.open({ boxId: till.id, count: notes(1), carryDifference: false }, cashier, DAY),
		).rejects.toMatchObject({
			response: { message: 'cash_box_switched_off' },
		});
		await s.repo.saveBox(till);
		await expect(
			s.cash.open(
				{
					boxId: till.id,
					count: { rows: [{ valuePaise: 200_000, kind: 'note', count: 1 }] },
					carryDifference: false,
				},
				cashier,
				DAY,
			),
		).rejects.toMatchObject({ response: { message: 'count_unknown_denomination' } });
		await s.cash.open({ boxId: till.id, count: notes(0), carryDifference: false }, cashier, DAY);
		await expect(
			s.cash.open({ boxId: till.id, count: notes(0), carryDifference: false }, cashier, DAY),
		).rejects.toMatchObject({
			response: { message: 'cash_sheet_exists' },
		});
		await expect(
			s.cash.open({ boxId: barasat.id, count: notes(0), carryDifference: false }, cashier, DAY),
		).resolves.toBeTruthy();
		const today = (await s.repo.openSheet(till.id)) as CashSheet;
		await s.cash.count(today.id, notes(0), cashier, DAY);
		await expect(
			s.cash.open({ boxId: till.id, count: notes(0), carryDifference: false }, cashier, DAY),
		).rejects.toMatchObject({ response: { message: 'cash_sheet_exists' } });
		await expect(s.cash.view('sh_gone', cashier)).rejects.toMatchObject({
			response: { message: 'cash_sheet_not_found' },
		});
	});

	it('closes a count that matches, asks once more, then takes a difference for a manager', async () => {
		const s = setup();
		const { till } = await withBoxes(s);
		const opened = await s.cash.open({ boxId: till.id, count: notes(0), carryDifference: false }, cashier, DAY);
		await sale(s, till, 300_000);
		const id = opened.sheet.id;
		await expect(s.cash.submitDifference(id, cashier, DAY)).rejects.toMatchObject({
			response: { message: 'cash_count_twice_first' },
		});
		expect(await s.cash.count(id, notes(5), cashier, DAY)).toEqual({ result: 'count_again', attempt: 1 });
		expect(await s.cash.count(id, notes(5), cashier, DAY)).toEqual({ result: 'still_off', attempt: 2 });
		await expect(s.cash.count(id, notes(5), other, DAY)).rejects.toMatchObject({
			response: { message: 'cash_close_another' },
		});
		await expect(s.cash.submitDifference(id, other, DAY)).rejects.toMatchObject({
			response: { message: 'cash_close_another' },
		});
		const closed = await s.cash.submitDifference(id, cashier, NEXT);
		expect(closed.sheet).toMatchObject({
			status: 'difference',
			differencePaise: -50_000,
			closedLate: true,
			expectedAtClosePaise: 300_000,
		});
		// Closed: the cashier now sees the amounts.
		expect((await s.cash.view(id, cashier)).amounts).toBe(true);
		await expect(s.cash.count(id, notes(6), cashier, DAY)).rejects.toMatchObject({
			response: { message: 'cash_sheet_not_open' },
		});
		await expect(s.cash.submitDifference(id, cashier, DAY)).rejects.toMatchObject({
			response: { message: 'cash_sheet_not_open' },
		});
		const second = setup();
		const boxes = await withBoxes(second);
		const sheet = await second.cash.open(
			{ boxId: boxes.till.id, count: notes(2), carryDifference: false },
			cashier,
			DAY,
		);
		await sale(second, boxes.till, 100_000);
		expect(await second.cash.count(sheet.sheet.id, notes(2), manager, DAY)).toEqual({
			result: 'closed',
			attempt: 1,
		});
		expect((await second.repo.sheet(sheet.sheet.id))?.status).toBe('closed');
	});

	it('refuses a difference once the expected has come round to the count', async () => {
		const s = setup();
		const { till } = await withBoxes(s);
		const opened = await s.cash.open({ boxId: till.id, count: notes(0), carryDifference: false }, cashier, DAY);
		await sale(s, till, 100_000);
		await s.cash.count(opened.sheet.id, notes(1), cashier, DAY);
		await s.cash.count(opened.sheet.id, notes(1), cashier, DAY);
		await s.ledger.post(
			{
				kind: 'journal',
				date: '2026-11-23',
				narration: 'Taken out',
				lines: [
					{ ledger: { id: 'led_debtors' }, locationId: till.locationId, debitPaise: 50_000 },
					{ ledger: { id: till.ledgerId }, locationId: till.locationId, creditPaise: 50_000 },
				],
				source: { type: 'journal', id: 'j1', number: null },
				idempotencyKey: 'j1',
			},
			{} as never,
		);
		await expect(s.cash.submitDifference(opened.sheet.id, cashier, DAY)).rejects.toMatchObject({
			response: { message: 'cash_count_matches' },
		});
	});

	it('writes off a difference within the auto-accept limit by itself, either way', async () => {
		const s = setup();
		const { till } = await withBoxes(s, 1_000);
		const opened = await s.cash.open({ boxId: till.id, count: notes(0), carryDifference: false }, cashier, DAY);
		await sale(s, till, 100_500);
		expect((await s.cash.count(opened.sheet.id, notes(2), cashier, DAY)).result).toBe('closed');
		const sheet = (await s.repo.sheet(opened.sheet.id)) as CashSheet;
		expect(sheet).toMatchObject({ status: 'settled', differencePaise: -500, settlement: { how: 'auto_accepted' } });
		expect(s.ledger.balance(till.ledgerId)).toBe(100_000);
		expect(s.ledger.balance('led_short')).toBe(500);
		const over = setup();
		const b = await withBoxes(over, 1_000);
		const o = await over.cash.open({ boxId: b.till.id, count: notes(0), carryDifference: false }, cashier, DAY);
		await sale(over, b.till, 99_500);
		await over.cash.count(o.sheet.id, notes(2), cashier, DAY);
		expect(over.ledger.balance('led_short')).toBe(-500);
	});

	it('won’t open while yesterday is open (O14) or a difference waits (O9) unless it is carried', async () => {
		const s = setup();
		const { till } = await withBoxes(s);
		const first = await s.cash.open({ boxId: till.id, count: notes(0), carryDifference: false }, cashier, DAY);
		expect((await s.cash.today(till.id, cashier, NEXT)).stillOpen).toEqual({
			sheetId: first.sheet.id,
			date: '2026-11-23',
		});
		await expect(
			s.cash.open({ boxId: till.id, count: notes(0), carryDifference: false }, cashier, NEXT),
		).rejects.toMatchObject({
			response: { message: 'cash_sheet_still_open' },
		});
		await sale(s, till, 300_000);
		await s.cash.count(first.sheet.id, notes(5), cashier, NEXT);
		await s.cash.count(first.sheet.id, notes(5), cashier, NEXT);
		await s.cash.submitDifference(first.sheet.id, cashier, NEXT);
		expect((await s.cash.today(till.id, cashier, NEXT)).unsettled).toEqual([
			{ sheetId: first.sheet.id, date: '2026-11-23', differencePaise: -50_000 },
		]);
		await expect(
			s.cash.open({ boxId: till.id, count: notes(5), carryDifference: false }, cashier, NEXT),
		).rejects.toMatchObject({
			response: { message: 'cash_difference_unsettled' },
		});
		const carried = await s.cash.open({ boxId: till.id, count: notes(5), carryDifference: true }, cashier, NEXT);
		expect(carried.sheet.carried).toHaveLength(1);
		expect(carried.sheet.openingExpectedPaise).toBe(250_000);
		const rows = (await s.cash.view(carried.sheet.id, manager)).rows;
		expect(rows.map((r) => [r.kind, r.expectedPaise])).toEqual([
			['opening', 300_000],
			['carried', -50_000],
		]);
	});
});

describe('moving cash on the sheet', () => {
	it('deposits to a bank, takes cash from it, and moves cash to another box', async () => {
		const s = setup();
		const { till, petty } = await withBoxes(s);
		const opened = await s.cash.open({ boxId: till.id, count: notes(0), carryDifference: false }, cashier, DAY);
		await sale(s, till, 500_000);
		await s.cash.move(
			opened.sheet.id,
			{ kind: 'bank_deposit', amountPaise: 300_000, toId: 'led_hdfc', slip: '4471', note: '' },
			cashier,
			DAY,
		);
		await s.cash.move(
			opened.sheet.id,
			{ kind: 'bank_withdrawal', amountPaise: 50_000, toId: 'led_od', slip: '', note: 'change' },
			cashier,
			DAY,
		);
		await s.cash.move(
			opened.sheet.id,
			{ kind: 'box_move', amountPaise: 20_000, toId: petty.id, slip: '', note: '' },
			cashier,
			DAY,
		);
		expect(s.ledger.balance(till.ledgerId)).toBe(230_000);
		expect(s.ledger.balance('led_hdfc')).toBe(300_000);
		expect(s.ledger.vouchers.at(-3)?.narration).toBe('Bank deposit · slip 4471');
		expect(s.ledger.vouchers.at(-2)?.narration).toBe('Cash from the bank · change');
		// The petty box had no open sheet: its line waits, and the next sheet takes it.
		expect(s.repo.lines.filter((l) => l.boxId === petty.id && l.sheetId === null)).toHaveLength(1);
		const pettySheet = await s.cash.open(
			{ boxId: petty.id, count: notes(0, 2), carryDifference: false },
			manager,
			DAY,
		);
		expect(await s.repo.linesOf(pettySheet.sheet.id)).toHaveLength(1);
	});

	it('refuses a move to the same box, a switched-off box, a ledger that isn’t a bank, or on a closed sheet', async () => {
		const s = setup();
		const { till, petty } = await withBoxes(s);
		const opened = await s.cash.open({ boxId: till.id, count: notes(0), carryDifference: false }, cashier, DAY);
		const move = (patch: Record<string, unknown>) =>
			s.cash.move(
				opened.sheet.id,
				{ kind: 'box_move', amountPaise: 100, toId: till.id, slip: '', note: '', ...patch } as never,
				cashier,
				DAY,
			);
		await expect(move({})).rejects.toMatchObject({ response: { message: 'cash_move_same_box' } });
		await s.repo.saveBox({ ...petty, active: false });
		await expect(move({ toId: petty.id })).rejects.toMatchObject({ response: { message: 'cash_move_same_box' } });
		await expect(move({ kind: 'bank_deposit', toId: 'led_ref' })).rejects.toMatchObject({
			response: { message: 'cash_move_needs_bank' },
		});
		await s.cash.count(opened.sheet.id, notes(0), cashier, DAY);
		await expect(move({ kind: 'bank_deposit', toId: 'led_hdfc' })).rejects.toMatchObject({
			response: { message: 'cash_sheet_not_open' },
		});
	});

	it('writes no line for a voucher that touches no box, and names a line by its voucher when there is no source', async () => {
		const s = setup();
		const { till } = await withBoxes(s);
		await s.cash.voucherPosted(
			{
				id: 'jv_x',
				lines: [{ ledgerId: 'led_hdfc', debitPaise: 1, creditPaise: 0 }],
			} as unknown as JournalVoucher,
			{} as never,
		);
		expect(s.repo.lines).toEqual([]);
		await s.cash.voucherPosted(
			{
				id: 'jv_y',
				number: 'JV/26-27/000009',
				kind: 'journal',
				date: '2026-11-23',
				narration: 'By hand',
				source: null,
				createdBy: null,
				createdAt: AT,
				lines: [
					{ ledgerId: till.ledgerId, debitPaise: 100, creditPaise: 0 },
					{ ledgerId: till.ledgerId, debitPaise: 0, creditPaise: 40 },
				],
			} as unknown as JournalVoucher,
			{} as never,
		);
		expect(s.repo.lines[0]).toMatchObject({
			kind: 'journal',
			ref: 'JV/26-27/000009',
			inPaise: 100,
			outPaise: 40,
			sheetId: null,
		});
	});
});

describe('the cash sheets list (O11) and choices', () => {
	it('lists every box and day with amounts for a manager, by location and by box, location or person', async () => {
		const s = setup();
		const { till, barasat } = await withBoxes(s);
		await s.cash.open({ boxId: till.id, count: notes(4), carryDifference: false }, cashier, DAY);
		await sale(s, till, 100_000);
		await s.cash.open({ boxId: barasat.id, count: notes(1), carryDifference: false }, far, DAY);
		const query = {
			from: '2026-11-01',
			to: '2026-11-30',
			chip: 'all' as const,
			locationId: null,
			search: '',
			page: 1,
			pageSize: 25,
		};
		const seen = await s.cash.list(query, manager);
		expect(seen.amounts).toBe(true);
		expect(
			seen.items.map((r) => [r.boxName, r.locationName, r.openingPaise, r.inPaise, r.countedPaise, r.openedBy]),
		).toEqual([
			['Counter till', 'Gariahat store', 200_000, 100_000, null, 'Priya Sen'],
			['Barasat till', 'Barasat warehouse', 50_000, 0, null, 'Far Away'],
		]);
		const hidden = await s.cash.list(query, far);
		expect(hidden.items.map((r) => [r.boxName, r.openingPaise])).toEqual([['Barasat till', null]]);
		expect((await s.cash.list({ ...query, locationId: 'loc_gar' }, far)).items).toEqual([]);
		expect((await s.cash.list({ ...query, locationId: 'loc_gar' }, manager)).items).toHaveLength(1);
		expect((await s.cash.list({ ...query, search: 'barasat' }, manager)).items.map((r) => r.boxName)).toEqual([
			'Barasat till',
		]);
		expect((await s.cash.list({ ...query, search: 'priya' }, manager)).items.map((r) => r.boxName)).toEqual([
			'Counter till',
		]);
		// A box or a sheet at a location the admin no longer has shows no location name.
		const orphan = {
			...((await s.repo.openSheet(barasat.id)) as CashSheet),
			id: 'sh_orphan',
			locationId: 'loc_gone',
			date: '2026-11-22',
			status: 'closed' as const,
			expectedAtClosePaise: 0,
		};
		await s.repo.insertSheet(orphan);
		s.repo.boxMap.set(barasat.id, { ...barasat, locationId: 'loc_gone' });
		expect((await s.cash.view('sh_orphan', manager)).locationName).toBe('');
		expect(
			(await s.cash.list({ ...query, search: 'barasat' }, manager)).items.map((r) => r.locationName),
		).toContain('');
		// A sheet whose box has gone shows no box name.
		s.repo.boxMap.delete(barasat.id);
		expect((await s.cash.list(query, manager)).items.at(-1)?.boxName).toBe('');
	});

	it('offers the boxes, banks, heads, ledgers, staff and locations a person may use', async () => {
		const s = setup();
		const { till } = await withBoxes(s);
		const choices = await s.cash.choices(far);
		expect(choices.boxes.map((b) => [b.name, b.locationName])).toEqual([['Barasat till', 'Barasat warehouse']]);
		expect(choices.banks.map((b) => b.id)).toEqual(['led_hdfc', 'led_od']);
		expect(choices.heads.map((b) => b.id)).toEqual(['led_ref', 'led_conv']);
		expect(choices.ledgers.some((l) => l.id === till.ledgerId)).toBe(false);
		expect(choices.staff.map((p) => p.name)).toEqual([
			'Priya Sen',
			'Rahul Das',
			'Meera Sharma',
			'owner@saha-textile.test',
			'Far Away',
		]);
		expect(choices.locations.map((l) => l.id)).toEqual(['loc_bar']);
		expect(choices).toMatchObject({ manager: false, superAdmin: false, userId: 'adm_far' });
		expect((await s.cash.choices(owner)).manager).toBe(true);
		// A box whose location is unknown shows no location name; a principal-less caller is nobody.
		await s.repo.saveBox({ ...till, locationId: 'loc_gone' });
		expect((await s.cash.choices(undefined)).boxes.find((b) => b.id === till.id)?.locationName).toBe('');
		expect(await s.cash.names(['adm_broken', null])).toBeTypeOf('function');
		expect((await s.cash.names(['adm_broken']))('adm_broken')).toBeNull();
	});
});

describe('settling a difference (O8)', () => {
	/** A till sheet closed short by ₹500 (expected ₹3,000, counted ₹2,500). */
	async function short(s: ReturnType<typeof setup>, box: 'till' | 'barasat' = 'till') {
		const boxes = await withBoxes(s);
		const target = boxes[box];
		const who = box === 'barasat' ? far : cashier;
		const opened = await s.cash.open({ boxId: target.id, count: notes(0), carryDifference: false }, who, DAY);
		await sale(s, target, 300_000);
		await s.cash.count(opened.sheet.id, notes(5), who, DAY);
		await s.cash.count(opened.sheet.id, notes(5), who, DAY);
		await s.cash.submitDifference(opened.sheet.id, who, DAY);
		return { ...boxes, sheet: (await s.repo.sheet(opened.sheet.id)) as CashSheet };
	}
	const write = (patch: Record<string, unknown> = {}) =>
		({
			how: 'write_off',
			note: '',
			recount: null,
			ledgerId: null,
			bankLedgerId: null,
			depositSlip: null,
			depositDate: null,
			staffUserId: null,
			repayBy: null,
			consent: false,
			policeReport: null,
			insured: false,
			noteDetails: null,
			version: 3,
			...patch,
		}) as never;

	it('adds a missed payment to the original day’s sheet, marked as added on review, and the books agree again', async () => {
		const s = setup();
		const { till, sheet } = await short(s);
		const settled = await s.cash.settle(
			sheet.id,
			write({ how: 'missed_payment_out', ledgerId: 'led_debtors', note: 'Refund ₹600 typed as ₹300' }),
			manager,
			NEXT,
		);
		expect(settled.sheet).toMatchObject({
			status: 'settled',
			settlement: { how: 'missed_payment_out', ledgerId: 'led_debtors' },
		});
		expect(s.ledger.vouchers.at(-1)).toMatchObject({
			date: '2026-11-23',
			source: { type: 'cashSettlement', id: sheet.id },
		});
		expect(s.ledger.balance(till.ledgerId)).toBe(250_000);
		expect(settled.rows.find((r) => r.kind === 'settlement')).toMatchObject({
			addedOnReview: true,
			outPaise: 50_000,
		});
		await expect(s.cash.settle(sheet.id, write(), manager, NEXT)).rejects.toMatchObject({
			response: { message: 'cash_nothing_to_settle' },
		});
	});

	it('takes the counting mistake from a recount that matches, and posts nothing', async () => {
		const s = setup();
		const { sheet } = await short(s);
		await expect(
			s.cash.settle(sheet.id, write({ how: 'counting_mistake', recount: notes(5) }), manager, NEXT),
		).rejects.toMatchObject({
			response: { message: 'recount_doesnt_match' },
		});
		const before = s.ledger.vouchers.length;
		const settled = await s.cash.settle(
			sheet.id,
			write({ how: 'counting_mistake', recount: notes(6) }),
			manager,
			NEXT,
		);
		expect(settled.sheet.settlement).toMatchObject({
			how: 'counting_mistake',
			voucherId: null,
			recount: { totalPaise: 300_000 },
		});
		expect(s.ledger.vouchers).toHaveLength(before);
	});

	it('recovers from a staff member by name, and refuses an unknown one', async () => {
		const s = setup();
		const { sheet } = await short(s);
		await expect(
			s.cash.settle(
				sheet.id,
				write({ how: 'recover_from_staff', staffUserId: 'adm_nobody', repayBy: 'cash' }),
				manager,
				NEXT,
			),
		).rejects.toMatchObject({ response: { message: 'staff_unknown' } });
		const settled = await s.cash.settle(
			sheet.id,
			write({ how: 'recover_from_staff', staffUserId: 'adm_rahul', repayBy: 'cash' }),
			manager,
			NEXT,
		);
		expect(settled.sheet.settlement).toMatchObject({ staffName: 'Rahul Das', repayBy: 'cash' });
		expect(s.ledger.balance('led_staff')).toBe(50_000);
	});

	it('needs a bank for a deposit nobody recorded, and the owner for a box the owner reviews', async () => {
		const s = setup();
		const { sheet } = await short(s);
		await expect(
			s.cash.settle(
				sheet.id,
				write({ how: 'banked_not_recorded', bankLedgerId: 'led_ref', depositDate: '2026-11-23' }),
				manager,
				NEXT,
			),
		).rejects.toMatchObject({ response: { message: 'cash_move_needs_bank' } });
		await expect(s.cash.settle(sheet.id, write({ how: 'theft' }), manager, NEXT)).rejects.toMatchObject({
			response: { message: 'police_report_required' },
		});
		const banked = await s.cash.settle(
			sheet.id,
			write({
				how: 'banked_not_recorded',
				bankLedgerId: 'led_hdfc',
				depositDate: '2026-11-23',
				depositSlip: '88',
			}),
			manager,
			NEXT,
		);
		expect(banked.sheet.settlement).toMatchObject({ depositSlip: '88', bankLedgerId: 'led_hdfc' });
		const owned = setup();
		const o = await short(owned, 'barasat');
		await expect(owned.cash.settle(o.sheet.id, write(), manager, NEXT)).rejects.toMatchObject({
			response: { message: 'cash_owner_settles' },
		});
		expect((await owned.cash.settle(o.sheet.id, write(), owner, NEXT)).sheet.status).toBe('settled');
	});

	it('says so when someone settled it first, and passes other failures on', async () => {
		const s = setup();
		const { sheet } = await short(s);
		await expect(s.cash.settle(sheet.id, write({ version: 1 }), manager, NEXT)).rejects.toMatchObject({
			response: { message: 'cash_sheet_changed' },
		});
		const broken = setup();
		const b = await short(broken);
		vi.spyOn(broken.repo, 'saveSheet').mockRejectedValueOnce(new Error('disk full'));
		await expect(broken.cash.settle(b.sheet.id, write(), manager, NEXT)).rejects.toThrow('disk full');
	});

	it('holds an unexplained excess in suspense, then lets it go to other income once its days are up', async () => {
		const s = setup();
		const { till } = await withBoxes(s);
		const opened = await s.cash.open({ boxId: till.id, count: notes(0), carryDifference: false }, cashier, DAY);
		await sale(s, till, 250_000);
		await s.cash.count(opened.sheet.id, notes(6), cashier, DAY);
		await s.cash.count(opened.sheet.id, notes(6), cashier, DAY);
		await s.cash.submitDifference(opened.sheet.id, cashier, DAY);
		await expect(s.cash.settle(opened.sheet.id, write({ how: 'write_off' }), manager, NEXT)).rejects.toMatchObject({
			response: { message: 'settlement_wrong_direction' },
		});
		const held = await s.cash.settle(opened.sheet.id, write({ how: 'excess_suspense' }), manager, NEXT);
		expect(held.sheet.settlement?.suspenseUntil).toBe('2026-12-24');
		expect(s.ledger.balance('led_susp')).toBe(-50_000);
		expect(await s.cash.releaseSuspense(NEXT)).toBe(0);
		expect(await s.cash.releaseSuspense(LATER)).toBe(1);
		expect(s.ledger.balance('led_susp')).toBe(0);
		expect(s.ledger.balance('led_other')).toBe(-50_000);
		expect((await s.repo.sheet(opened.sheet.id))?.settlement?.releaseVoucherId).toBeTruthy();
		expect(await s.cash.releaseSuspense(LATER)).toBe(0);
		// A box that has gone is skipped.
		const sheet = (await s.repo.sheet(opened.sheet.id)) as CashSheet;
		await s.repo.insertSheet({
			...sheet,
			id: 'sh_orphan',
			boxId: 'box_gone',
			settlement: { ...(sheet.settlement as NonNullable<CashSheet['settlement']>), releaseVoucherId: null },
		});
		expect(await s.cash.releaseSuspense(LATER)).toBe(1);
	});
});

describe('petty expenses and refills (O4, O13)', () => {
	const pay = (boxId: string, patch: Record<string, unknown> = {}) =>
		({
			boxId,
			headLedgerId: 'led_conv',
			amountPaise: 12_000,
			paidTo: 'Bike courier rider',
			whatFor: 'Urgent saree to Jadavpur',
			billMediaId: null,
			gst: null,
			...patch,
		}) as never;

	it('checks the day’s cash to the payee, the open sheet and the bill before paying', async () => {
		const s = setup();
		const { till } = await withBoxes(s);
		expect(await s.petty.check(till.id, '', 12_000, cashier, DAY)).toEqual({
			paidTodayPaise: 0,
			limitPaise: 1_000_000,
			withinLimit: true,
			sheetOpen: false,
			openedAt: null,
			billNeeded: false,
		});
		await expect(s.petty.pay(pay(till.id), cashier, DAY)).rejects.toMatchObject({
			response: { message: 'cash_sheet_not_open' },
		});
		await s.cash.open({ boxId: till.id, count: notes(4), carryDifference: false }, cashier, DAY);
		await expect(s.petty.pay(pay(till.id, { amountPaise: 60_000 }), cashier, DAY)).rejects.toMatchObject({
			response: { message: 'bill_photo_required' },
		});
		await expect(
			s.petty.pay(pay(till.id, { amountPaise: 1_000_100, billMediaId: 'med_bill' }), cashier, DAY),
		).rejects.toMatchObject({
			response: { message: 'cash_limit_exceeded' },
		});
		await expect(s.petty.pay(pay(till.id, { headLedgerId: 'led_old_head' }), cashier, DAY)).rejects.toMatchObject({
			response: { message: 'not_a_petty_head' },
		});
		// The till closed between the checks and the payment.
		const real = s.repo.openSheet.bind(s.repo);
		vi.spyOn(s.repo, 'openSheet').mockImplementationOnce(real).mockResolvedValueOnce(null);
		await expect(s.petty.pay(pay(till.id), cashier, DAY)).rejects.toMatchObject({
			response: { message: 'cash_sheet_not_open' },
		});
		const paid = await s.petty.pay(pay(till.id), cashier, DAY);
		expect(paid).toMatchObject({ headName: 'led_conv', gst: null });
		expect((await s.petty.check(till.id, 'bike courier rider', 1, cashier, DAY)).paidTodayPaise).toBe(12_000);
		const unlimited = setup({ limit: null });
		const u = await withBoxes(unlimited);
		expect((await unlimited.petty.check(u.till.id, 'x', 99_999_999, cashier, DAY)).withinLimit).toBe(true);
	});

	it('takes input GST from a GST bill with our GSTIN, within the State or across', async () => {
		const s = setup();
		const { till, barasat } = await withBoxes(s);
		await s.cash.open({ boxId: till.id, count: notes(4), carryDifference: false }, cashier, DAY);
		const bill = (gstin: string) => ({
			supplierGstin: gstin,
			supplierName: 'Paper House',
			billNumber: 'PH/88',
			billDate: '2026-11-23',
			ratePercent: 18,
		});
		const within = await s.petty.pay(
			pay(till.id, { amountPaise: 11_800, gst: bill('19AAAAA0000A1Z5') }),
			cashier,
			DAY,
		);
		expect(within.gst).toMatchObject({ taxablePaise: 10_000, cgstPaise: 900, sgstPaise: 900, igstPaise: 0 });
		expect(s.ledger.balance('led_icgst')).toBe(900);
		const across = await s.petty.pay(
			pay(till.id, { amountPaise: 11_800, gst: bill('27AAAAA0000A1Z5') }),
			cashier,
			DAY,
		);
		expect(across.gst?.igstPaise).toBe(1_800);
		await s.cash.open({ boxId: barasat.id, count: notes(1), carryDifference: false }, manager, DAY);
		await expect(
			s.petty.pay(pay(barasat.id, { gst: bill('19AAAAA0000A1Z5') }), manager, DAY),
		).rejects.toMatchObject({
			response: { message: 'petty_gst_needs_our_gstin' },
		});
		s.repo.boxMap.set(barasat.id, { ...barasat, locationId: 'loc_nowhere' });
		await expect(
			s.petty.pay(pay(barasat.id, { gst: bill('19AAAAA0000A1Z5') }), manager, DAY),
		).rejects.toMatchObject({
			response: { message: 'petty_gst_needs_our_gstin' },
		});
	});

	it('lists petty expenses with box and payer names, at the person’s boxes', async () => {
		const s = setup();
		const { till, barasat } = await withBoxes(s);
		await s.cash.open({ boxId: till.id, count: notes(4), carryDifference: false }, cashier, DAY);
		await s.cash.open({ boxId: barasat.id, count: notes(1), carryDifference: false }, far, DAY);
		await s.petty.pay(pay(till.id), cashier, DAY);
		await s.petty.pay(pay(barasat.id), far, DAY);
		const query = { from: '2026-11-01', to: '2026-11-30', boxId: null, search: '', page: 1, pageSize: 25 };
		const all = await s.petty.list(query, manager);
		expect(all.items.map((p) => [p.boxName, p.byName])).toEqual([
			['Counter till', 'Priya Sen'],
			['Barasat till', 'Far Away'],
		]);
		expect((await s.petty.list(query, far)).items.map((p) => p.boxName)).toEqual(['Barasat till']);
		expect((await s.petty.list({ ...query, boxId: till.id }, manager)).items).toHaveLength(1);
		s.repo.boxMap.delete(till.id);
		expect((await s.petty.list(query, manager)).items[0]?.boxName).toBe('');
	});

	it('refills a fixed float from a bank, back to its amount, with what was spent by head', async () => {
		const s = setup();
		const { till, petty } = await withBoxes(s);
		await expect(s.petty.refillPreview(till.id, manager)).rejects.toMatchObject({
			response: { message: 'not_a_fixed_float' },
		});
		await expect(
			s.petty.refill(till.id, { fromLedgerId: 'led_hdfc', amountPaise: 1 }, manager, DAY),
		).rejects.toMatchObject({
			response: { message: 'not_a_fixed_float' },
		});
		await s.cash.open({ boxId: petty.id, count: notes(0), carryDifference: false }, manager, DAY);
		await s.petty.refill(petty.id, { fromLedgerId: 'led_hdfc', amountPaise: 500_000 }, manager, DAY);
		await s.petty.pay(pay(petty.id, { headLedgerId: 'led_ref', amountPaise: 14_200 }), manager, DAY);
		await s.petty.pay(pay(petty.id, { amountPaise: 10_400 }), manager, DAY);
		const preview = await s.petty.refillPreview(petty.id, manager);
		expect(preview).toMatchObject({ spentPaise: 24_600, refillPaise: 24_600 });
		expect(preview.heads.map((h) => h.headLedgerId)).toEqual(['led_ref', 'led_conv']);
		await expect(
			s.petty.refill(petty.id, { fromLedgerId: 'led_ref', amountPaise: 24_600 }, manager, DAY),
		).rejects.toMatchObject({
			response: { message: 'cash_move_needs_bank' },
		});
		const after = await s.petty.refill(petty.id, { fromLedgerId: 'led_hdfc', amountPaise: 24_600 }, manager, DAY);
		expect(after).toMatchObject({ spentPaise: 0, refillPaise: 0 });
		expect(s.ledger.balance(petty.ledgerId)).toBe(500_000);
	});
});

describe('expense claims (O12)', () => {
	const claim = (patch: Record<string, unknown> = {}) =>
		({
			staffUserId: null,
			locationId: 'loc_gar',
			headLedgerId: 'led_conv',
			amountPaise: 45_000,
			whatFor: 'Auto to Barasat',
			billMediaId: null,
			spentOn: '2026-11-21',
			...patch,
		}) as never;
	const decide = (patch: Record<string, unknown>) =>
		({ decision: 'approve', payBoxId: null, bankLedgerId: null, version: 0, ...patch }) as never;

	it('takes a claim for oneself, or from a manager for someone else, and refuses what can’t be claimed', async () => {
		const s = setup();
		await withBoxes(s);
		const mine = await s.claims.create(claim(), cashier, DAY);
		expect(mine).toMatchObject({
			number: 'EC/26-27/000001',
			staffName: 'Priya Sen',
			status: 'waiting',
			billName: null,
		});
		const forRahul = await s.claims.create(
			claim({ staffUserId: 'adm_rahul', amountPaise: 60_000, billMediaId: 'med_bill' }),
			manager,
			DAY,
		);
		expect(forRahul).toMatchObject({ staffName: 'Rahul Das', billName: 'auto-receipt', createdBy: 'adm_meera' });
		await expect(s.claims.create(claim(), far, DAY)).rejects.toMatchObject({
			response: { message: 'location_out_of_scope' },
		});
		await expect(s.claims.create(claim(), undefined, DAY)).rejects.toMatchObject({
			response: { message: 'staff_unknown' },
		});
		await expect(s.claims.create(claim({ staffUserId: 'adm_rahul' }), cashier, DAY)).rejects.toMatchObject({
			response: { message: 'claim_for_another' },
		});
		await expect(s.claims.create(claim({ staffUserId: 'adm_nobody' }), manager, DAY)).rejects.toMatchObject({
			response: { message: 'staff_unknown' },
		});
		await expect(s.claims.create(claim({ headLedgerId: 'led_hdfc' }), cashier, DAY)).rejects.toMatchObject({
			response: { message: 'not_a_petty_head' },
		});
		await expect(s.claims.create(claim({ amountPaise: 60_000 }), cashier, DAY)).rejects.toMatchObject({
			response: { message: 'bill_photo_required' },
		});
		await expect(s.claims.create(claim({ billMediaId: 'med_gone' }), cashier, DAY)).rejects.toMatchObject({
			response: { message: 'bill_not_found' },
		});
		expect((await s.claims.get(mine.id, manager)).locationName).toBe('Gariahat store');
		await expect(s.claims.get('ec_gone', manager)).rejects.toMatchObject({
			response: { message: 'expense_claim_not_found' },
		});
		await expect(s.claims.get(mine.id, far)).rejects.toMatchObject({
			response: { message: 'location_out_of_scope' },
		});
		s.repo.claimMap.set('ec_odd', { ...mine, id: 'ec_odd', locationId: 'loc_gone' });
		expect((await s.claims.get('ec_odd', manager)).locationName).toBe('');
	});

	it('approves with the salary, from petty cash or by bank, and rejects with a reason', async () => {
		const s = setup();
		const { petty } = await withBoxes(s);
		const one = await s.claims.create(claim(), cashier, DAY);
		await expect(s.claims.decide(one.id, decide({ payBack: 'salary' }), cashier, DAY)).rejects.toMatchObject({
			response: { message: 'claim_own_approval' },
		});
		const salary = await s.claims.decide(one.id, decide({ payBack: 'salary' }), manager, DAY);
		expect(salary).toMatchObject({ status: 'approved', payrollMonth: '2026-11', payBack: 'salary' });
		expect(s.ledger.balance('led_emp')).toBe(-45_000);
		await expect(
			s.claims.decide(one.id, decide({ payBack: 'salary', version: 1 }), manager, DAY),
		).rejects.toMatchObject({
			response: { message: 'expense_claim_decided' },
		});
		const two = await s.claims.create(claim(), cashier, DAY);
		await expect(s.claims.decide(two.id, decide({ payBack: 'petty' }), manager, DAY)).rejects.toMatchObject({
			response: { message: 'claim_needs_a_box' },
		});
		await expect(
			s.claims.decide(two.id, decide({ payBack: 'petty', payBoxId: petty.id }), manager, DAY),
		).rejects.toMatchObject({
			response: { message: 'cash_sheet_not_open' },
		});
		await s.cash.open({ boxId: petty.id, count: notes(0), carryDifference: false }, manager, DAY);
		const paid = await s.claims.decide(two.id, decide({ payBack: 'petty', payBoxId: petty.id }), manager, DAY);
		expect(paid).toMatchObject({ status: 'paid', payBoxId: petty.id, bankLedgerId: null });
		expect(s.repo.lines.at(-1)).toMatchObject({ kind: 'claim_paid', outPaise: 45_000 });
		const three = await s.claims.create(claim(), cashier, DAY);
		await expect(
			s.claims.decide(three.id, decide({ payBack: 'bank', bankLedgerId: 'led_ref' }), manager, DAY),
		).rejects.toMatchObject({
			response: { message: 'cash_move_needs_bank' },
		});
		await expect(s.claims.decide(three.id, decide({ payBack: 'bank' }), manager, DAY)).rejects.toMatchObject({
			response: { message: 'cash_move_needs_bank' },
		});
		const banked = await s.claims.decide(
			three.id,
			decide({ payBack: 'bank', bankLedgerId: 'led_hdfc' }),
			owner,
			DAY,
		);
		expect(banked).toMatchObject({ status: 'paid', bankLedgerId: 'led_hdfc' });
		const four = await s.claims.create(claim(), cashier, DAY);
		const rejected = await s.claims.decide(
			four.id,
			{ decision: 'reject', reason: 'No bill', version: 0 },
			manager,
			DAY,
		);
		expect(rejected).toMatchObject({ status: 'rejected', rejectReason: 'No bill' });
		expect(s.logged.at(-1)?.[1]).toBe('cash.claim.reject');
	});

	it('says so when someone decided first, passes other failures on, and lists claims where the person works', async () => {
		const s = setup();
		await withBoxes(s);
		const one = await s.claims.create(claim(), cashier, DAY);
		await expect(
			s.claims.decide(one.id, { decision: 'reject', reason: 'x', version: 5 }, manager, DAY),
		).rejects.toMatchObject({
			response: { message: 'expense_claim_changed' },
		});
		vi.spyOn(s.repo, 'saveClaim').mockRejectedValueOnce(new Error('disk full'));
		await expect(
			s.claims.decide(one.id, { decision: 'reject', reason: 'x', version: 0 }, manager, DAY),
		).rejects.toThrow('disk full');
		await s.repo.insertClaim({ ...one, id: 'ec_bar', locationId: 'loc_bar' });
		await s.repo.insertClaim({ ...one, id: 'ec_gone', locationId: 'loc_gone' });
		const query = { from: '2026-11-01', to: '2026-11-30', chip: 'all' as const, search: '', page: 1, pageSize: 25 };
		expect((await s.claims.list(query, manager)).items.map((c) => c.locationName)).toEqual([
			'Gariahat store',
			'Barasat warehouse',
			'',
		]);
		expect((await s.claims.list(query, far)).items.map((c) => c.id)).toEqual(['ec_bar']);
	});
});

describe('the hourly sweep and the chart helpers', () => {
	afterEach(() => vi.unstubAllEnvs());

	it('lets suspense go every hour, says when it failed, and does nothing in tests or a docs build', async () => {
		const s = setup();
		const release = vi.spyOn(s.cash, 'releaseSuspense').mockResolvedValue(0);
		s.cash.onApplicationBootstrap();
		s.cash.onApplicationShutdown();
		vi.stubEnv('SAHA_TEXTILE_DOCUMENTATION_BUILD', '1');
		s.cash.onApplicationBootstrap();
		vi.stubEnv('SAHA_TEXTILE_DOCUMENTATION_BUILD', '');
		vi.stubEnv('VITEST', '');
		vi.useFakeTimers();
		s.cash.onApplicationBootstrap();
		await vi.advanceTimersByTimeAsync(CASH_SWEEP_MS);
		s.cash.onApplicationShutdown();
		vi.useRealTimers();
		expect(release).toHaveBeenCalledOnce();
		release.mockRejectedValueOnce(new Error('down')).mockRejectedValueOnce('odd');
		await s.cash.sweep();
		await s.cash.sweep();
		expect(release).toHaveBeenCalledTimes(3);
	});

	it('finds cash, banks and heads by the roles their groups play, never looping on a bad chart', () => {
		const chart = cashChart();
		expect(cashGroup(chart)?.id).toBe('g_cash');
		expect(isBank(chart, 'led_od')).toBe(true);
		expect(isBank(chart, 'led_ref')).toBe(false);
		expect(groupPlays(chart.groups, 'g_missing', 'bank_accounts')).toBe(false);
		const loop = [
			{ id: 'a', parentId: 'b', systemKey: null, roles: [] },
			{ id: 'b', parentId: 'a', systemKey: null, roles: [] },
		] as never;
		expect(groupPlays(loop, 'a', 'cash_in_hand')).toBe(false);
		expect(cashGroup({ groups: [], ledgers: [] } as never)).toBeNull();
		expect(personName(null)).toBeNull();
		expect(personName({ username: 'meera' })).toBe('meera');
		expect(stateOf('19ABCDE1234F1Z5')).toBe('19');
	});
});
