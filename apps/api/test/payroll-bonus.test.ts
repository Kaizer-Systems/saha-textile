import { ConflictException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Attendance, Employee, PayrollRow, PayrollRulesVersion, PayrollRun } from '@saha-textile/contracts';
import { BONUS_2026, bonusOn } from '@saha-textile/core-domain';
import { describe, expect, it, vi } from 'vitest';

import { PERMISSIONS_KEY } from '../src/auth/session.guard';
import { PayrollController } from '../src/payroll/payroll.controller';
import { BUILT_IN_PAYROLL_RULES, PayrollRulesService, rulesOf } from '../src/payroll/payroll-rules.service';
import { PayrollService } from '../src/payroll/payroll.service';

/**
 * Statutory bonus (brief 25 BN1): once the headcount reaches the Act's figure, each run keeps covered people's bonus
 * wages and posts the month's provision; the year's bonus is shown against what the Act asks and paid once from a
 * bank, the provision off the payable and any difference to the year's expense.
 */

const at = '2027-04-20T06:00:00.000Z';
const now = new Date(at);
const refusal = (code: string) => ({ response: { message: code } });
const ca = { userId: 'adm_ca', permissions: ['accounts.post', 'accounts.lock'] } as never;
/** ₹7,000 of bonus wages for a full month at 8.33%. */
const MONTH_BONUS = bonusOn(7_000_00, BONUS_2026);

const employee = (id: string, basic: number, da: number, locationId = 'loc_bar'): Employee => ({
	id,
	name: id,
	code: '',
	designation: '',
	department: '',
	userId: null,
	locationId,
	joinedOn: '2025-04-01',
	leftOn: null,
	pan: '',
	aadhaar: '',
	uan: '',
	esiNumber: '',
	ptState: '19',
	taxRegime: 'new',
	dateOfBirth: null,
	taxDeclarations: [],
	bankAccount: '',
	ifsc: '',
	pfOn: false,
	esiOn: false,
	structure: { basic, da, hra: 0, special: 4_000, conveyance: 0, other: 0 },
	advanceDueINR: 0,
	advancePerMonthINR: 0,
	createdAt: '2026-04-01T00:00:00.000Z',
	updatedAt: '2026-04-01T00:00:00.000Z',
	version: 0,
});
/** Meera's basic and DA are ₹8,000 (covered, wages held at ₹7,000); Sudip's ₹25,000 (not covered). */
const MEERA = employee('emp_meera', 6_000, 2_000);
const SUDIP = employee('emp_sudip', 25_000, 0, 'loc_shop');
const attendance = (ids: string[]): Attendance => ({
	month: '2026-11',
	daysInMonth: 30,
	rows: ids.map((employeeId) => ({ employeeId, paidDays: 30, leaveTaken: 0, note: '' })),
	lockedAt: at,
	lockedBy: 'adm_clerk',
	version: 1,
});

const row = (employeeId: string, over: Partial<PayrollRow> = {}): PayrollRow => ({
	employeeId,
	name: employeeId,
	locationId: 'loc_bar',
	paidDays: 30,
	grossPaise: 12_000_00,
	pfWagesPaise: 0,
	pfEmployeePaise: 0,
	pfEmployerPaise: 0,
	epsPaise: 0,
	esiEmployeePaise: 0,
	esiEmployerPaise: 0,
	ptPaise: 0,
	tdsPaise: 0,
	advancePaise: 0,
	netPaise: 12_000_00,
	...over,
});
const run = (month: string, status: string, rows: PayrollRow[]) =>
	({
		id: `pay_${month}`,
		month,
		status,
		rows,
		rulesFrom: '2026-04-01',
		voucherId: null,
		payVoucherId: null,
		approvedBy: null,
		approvedAt: null,
		createdAt: at,
		updatedAt: at,
		version: 3,
	}) as PayrollRun;

interface Options {
	people?: Employee[];
	attendance?: Attendance;
	runs?: PayrollRun[];
	bonus?: PayrollRulesVersion['bonus'];
	bonusHeadcount?: number;
	/** The pay heads the rules count as wages (the Code's list when absent). */
	wageHeads?: PayrollRulesVersion['wageHeads'];
}

function build(options: Options = {}) {
	const people = options.people ?? [MEERA, SUDIP];
	const runStore = new Map((options.runs ?? []).map((r) => [r.month, r]));
	const runs = {
		list: async () => [...runStore.values()],
		get: async (month: string) => runStore.get(month) ?? null,
		save: vi.fn(async (r: PayrollRun, expectedVersion: number | null) => {
			const saved = { ...r, version: expectedVersion === null ? 0 : expectedVersion + 1 };
			runStore.set(r.month, saved);
			return saved;
		}),
	};
	const chart = {
		groups: [
			{ id: 'g_ind', systemKey: 'indirect_expenses' },
			{ id: 'g_cl', systemKey: 'current_liabilities' },
			{ id: 'g_prov', systemKey: 'provisions' },
		],
		ledgers: [
			{ id: 'led_tds', groupId: 'g_cl', name: 'TDS payable', roles: ['tds_payable'] },
			{ id: 'led_advance', groupId: 'g_ca', name: 'Staff advances', roles: ['staff_advance'] },
		] as { id: string; groupId: string; name: string; roles: string[] }[],
	};
	const posted: { idempotencyKey: string; id: string }[] = [];
	const ledger = {
		chart: async () => chart,
		addLedger: vi.fn(async (write: { name: string; groupId: string }) => {
			const made = {
				id: `led_${write.name.toLowerCase().replace(/\W+/g, '_')}`,
				groupId: write.groupId,
				name: write.name,
				roles: [],
			};
			chart.ledgers.push(made);
			return made;
		}),
		post: vi.fn(async (request: { idempotencyKey: string }, _context: unknown, _by: string | null) => {
			const voucher = { idempotencyKey: request.idempotencyKey, id: `jv_${posted.length + 1}` };
			posted.push(voucher);
			return { id: voucher.id };
		}),
		voucherByKey: vi.fn(async (key: string) => posted.find((v) => v.idempotencyKey === key) ?? null),
	};
	const rules = {
		forMonth: vi.fn(async () =>
			rulesOf({
				...BUILT_IN_PAYROLL_RULES,
				bonusHeadcount: options.bonusHeadcount ?? 2,
				bonus: options.bonus ?? BONUS_2026,
				...(options.wageHeads ? { wageHeads: options.wageHeads } : {}),
			}),
		),
	};
	const service = new PayrollService(
		{ list: async () => people, get: async (id: string) => people.find((p) => p.id === id) ?? null } as never,
		{ get: async () => options.attendance ?? attendance(people.map((p) => p.id)) } as never,
		runs as never,
		ledger as never,
		{ withTransaction: async <T>(work: (context: unknown) => Promise<T>) => work({ session: 'tx' }) } as never,
		{ append: async () => undefined } as never,
		rules as never,
		{ list: async () => [{ id: 'loc_bar', stateCode: '19' }] } as never,
		{ issue: async () => 'PS/26-27/000001' } as never,
	);
	return { service, ledger, rules, runStore, chart };
}
const bonusOf = (run: PayrollRun) => run.rows.map((r) => [r.employeeId, r.bonusWagesPaise, r.bonusPaise]);

describe('the month’s bonus in a run (BN1)', () => {
	it('keeps covered people’s bonus wages and provides the bonus once the headcount reaches the Act’s', async () => {
		const run = await build().service.prepare('2026-11', now);
		expect(bonusOf(run)).toEqual([
			['emp_meera', 7_000_00, MONTH_BONUS],
			['emp_sudip', 0, 0],
		]);
		expect(MONTH_BONUS).toBe(58_310);
	});

	it('keeps the wages but provides nothing when the bonus is worked out only at the year’s end', async () => {
		const run = await build({ bonus: { ...BONUS_2026, provision: 'year_end' } }).service.prepare('2026-11', now);
		expect(bonusOf(run)).toEqual([
			['emp_meera', 7_000_00, 0],
			['emp_sudip', 0, 0],
		]);
	});

	it('counts as wages only the pay heads the rules name, when they name them', async () => {
		// ₹3,500 basic, ₹1,000 DA and ₹4,000 special allowance: ₹8,500 a month.
		const people = [employee('emp_rita', 3_500, 1_000), SUDIP];
		const codeHeads = await build({ people }).service.prepare('2026-11', now);
		const ownHeads = await build({ people, wageHeads: ['basic', 'da'] }).service.prepare('2026-11', now);
		// The Code's heads (special allowance included): ₹8,500, held at the ₹7,000 ceiling.
		expect(bonusOf(codeHeads)[0]).toEqual(['emp_rita', 7_000_00, bonusOn(7_000_00, BONUS_2026)]);
		// Basic and DA only: ₹4,500, more than half the pay, so the half-pay rule doesn't lift it.
		expect(bonusOf(ownHeads)[0]).toEqual(['emp_rita', 4_500_00, bonusOn(4_500_00, BONUS_2026)]);
	});

	it('has no bonus below the Act’s headcount', async () => {
		const run = await build({ people: [MEERA] }).service.prepare('2026-11', now);
		expect(bonusOf(run)).toEqual([['emp_meera', 0, 0]]);
	});

	it('posts the provision from Bonus to Bonus payable at each location, making both ledgers', async () => {
		const approved = run('2026-11', 'approved', [
			row('emp_meera', { bonusPaise: MONTH_BONUS }),
			row('emp_asha', { locationId: 'loc_shop', bonusPaise: 20_000 }),
			row('emp_sudip', { locationId: 'loc_shop' }),
		]);
		const { service, ledger } = build({ runs: [approved] });
		await service.step('2026-11', { to: 'posted', version: 3, bankLedgerId: null, paidOn: null }, ca, now);
		expect(ledger.addLedger.mock.calls.map(([w]) => [w.name, w.groupId])).toEqual(
			expect.arrayContaining([
				['Bonus', 'g_ind'],
				['Bonus payable', 'g_prov'],
			]),
		);
		const { lines } = ledger.post.mock.calls[0]?.[0] as unknown as {
			lines: { ledger: { id: string }; locationId: string; debitPaise?: number; creditPaise?: number }[];
		};
		const of = (id: string) => lines.filter((l) => l.ledger.id === id).map((l) => [l.locationId, l]);
		expect(of('led_bonus')).toEqual([
			['loc_bar', expect.objectContaining({ debitPaise: MONTH_BONUS })],
			['loc_shop', expect.objectContaining({ debitPaise: 20_000 })],
		]);
		expect(of('led_bonus_payable')).toEqual([
			['loc_bar', expect.objectContaining({ creditPaise: MONTH_BONUS })],
			['loc_shop', expect.objectContaining({ creditPaise: 20_000 })],
		]);
	});
});

/**
 * 2026-27, listed out of order. Meera: ₹14,000 of wages and their bonus provided (and an older row without either).
 * Priya: ₹7,000 of wages provided nothing. Asha: ₹7,000 of wages with ₹800 provided at a higher rate, last at the shop.
 * Sudip earned no bonus wages. A draft run, last year's March and next year's April don't count.
 */
const YEAR_RUNS = [
	run('2026-06', 'paid', [
		row('emp_meera', { bonusWagesPaise: 7_000_00, bonusPaise: MONTH_BONUS }),
		row('emp_asha', { locationId: 'loc_shop', bonusWagesPaise: 0, bonusPaise: 0 }),
	]),
	run('2026-04', 'posted', [row('emp_meera'), row('emp_sudip', { bonusWagesPaise: 0 })]),
	run('2026-05', 'posted', [
		row('emp_meera', { bonusWagesPaise: 7_000_00, bonusPaise: MONTH_BONUS }),
		row('emp_priya', { bonusWagesPaise: 7_000_00, bonusPaise: 0 }),
		row('emp_asha', { bonusWagesPaise: 7_000_00, bonusPaise: 80_000 }),
	]),
	// A draft: not counted, and Asha's move to the kiosk in it doesn't move where her bonus is paid.
	run('2026-07', 'draft', [
		row('emp_meera', { bonusWagesPaise: 7_000_00, bonusPaise: MONTH_BONUS }),
		row('emp_asha', { locationId: 'loc_kiosk', bonusWagesPaise: 7_000_00, bonusPaise: MONTH_BONUS }),
	]),
	run('2026-03', 'posted', [row('emp_meera', { bonusWagesPaise: 7_000_00, bonusPaise: MONTH_BONUS })]),
	run('2027-04', 'posted', [row('emp_meera', { bonusWagesPaise: 7_000_00, bonusPaise: MONTH_BONUS })]),
];

describe('the year’s bonus (BN1)', () => {
	it('adds up each covered person’s wages and provision from the year’s posted runs, against what the Act asks', async () => {
		const { service, rules, ledger } = build({ runs: YEAR_RUNS });
		const year = await service.bonusYear('2026-27');
		expect(rules.forMonth).toHaveBeenCalledWith('2027-03');
		expect(ledger.voucherByKey).toHaveBeenCalledWith('bonusPay:2026-27');
		expect(year).toEqual({
			year: '2026-27',
			ratePct: 8.33,
			rows: [
				{
					employeeId: 'emp_meera',
					name: 'emp_meera',
					wagesPaise: 14_000_00,
					providedPaise: 2 * MONTH_BONUS,
					daysWorked: 90,
					duePaise: bonusOn(14_000_00, BONUS_2026),
				},
				{
					employeeId: 'emp_asha',
					name: 'emp_asha',
					wagesPaise: 7_000_00,
					providedPaise: 80_000,
					daysWorked: 60,
					duePaise: MONTH_BONUS,
				},
				{
					employeeId: 'emp_priya',
					name: 'emp_priya',
					wagesPaise: 7_000_00,
					providedPaise: 0,
					daysWorked: 30,
					duePaise: MONTH_BONUS,
				},
			],
			providedPaise: 2 * MONTH_BONUS + 80_000,
			duePaise: bonusOn(14_000_00, BONUS_2026) + 2 * MONTH_BONUS,
			paidVoucherId: null,
		});
	});

	it('pays it once from a bank: provision off the payable, the rest to expense, any over-provision back', async () => {
		const { service, ledger } = build({ runs: YEAR_RUNS });
		const paid = await service.payBonus('2026-27', { bankLedgerId: 'led_bank', paidOn: '2027-04-20' }, ca);
		const [request, context, by] = ledger.post.mock.calls[0] as unknown as [
			{ lines: { ledger: { id: string }; locationId: string; debitPaise?: number; creditPaise?: number }[] },
			unknown,
			string,
		];
		expect(request).toMatchObject({
			kind: 'journal',
			date: '2027-04-20',
			narration: 'Bonus for 2026-27',
			source: { type: 'bonus', id: '2026-27', number: null },
			idempotencyKey: 'bonusPay:2026-27',
		});
		expect([context, by]).toEqual([{ session: 'tx' }, 'adm_ca']);
		const meeraDue = bonusOn(14_000_00, BONUS_2026);
		expect(request.lines).toEqual([
			// Meera: provided exactly what is due.
			{ ledger: { id: 'led_bonus_payable' }, locationId: 'loc_bar', debitPaise: meeraDue },
			{ ledger: { id: 'led_bank' }, locationId: 'loc_bar', creditPaise: meeraDue },
			// Asha, last at the shop: ₹800 provided, ₹583.10 due; the rest of the provision back to expense.
			{ ledger: { id: 'led_bonus_payable' }, locationId: 'loc_shop', debitPaise: MONTH_BONUS },
			{ ledger: { id: 'led_bonus_payable' }, locationId: 'loc_shop', debitPaise: 80_000 - MONTH_BONUS },
			{ ledger: { id: 'led_bonus' }, locationId: 'loc_shop', creditPaise: 80_000 - MONTH_BONUS },
			{ ledger: { id: 'led_bank' }, locationId: 'loc_shop', creditPaise: MONTH_BONUS },
			// Priya: nothing provided, all of it this year's expense.
			{ ledger: { id: 'led_bonus' }, locationId: 'loc_bar', debitPaise: MONTH_BONUS },
			{ ledger: { id: 'led_bank' }, locationId: 'loc_bar', creditPaise: MONTH_BONUS },
		]);
		const debits = request.lines.reduce((s, l) => s + (l.debitPaise ?? 0), 0);
		expect(debits).toBe(request.lines.reduce((s, l) => s + (l.creditPaise ?? 0), 0));
		expect(paid.paidVoucherId).toBe('jv_1');
		// Paid once.
		await expect(
			service.payBonus('2026-27', { bankLedgerId: 'led_bank', paidOn: '2027-04-21' }, undefined),
		).rejects.toBeInstanceOf(ConflictException);
		await expect(
			service.payBonus('2026-27', { bankLedgerId: 'led_bank', paidOn: '2027-04-21' }, undefined),
		).rejects.toMatchObject(refusal('bonus_paid'));
	});

	it('owes no bonus for under 30 days’ work, and takes back what was provided for it', async () => {
		const { service, ledger } = build({
			runs: [
				run('2026-05', 'posted', [
					// Exactly 30 days: covered.
					row('emp_meera', { bonusWagesPaise: 7_000_00, bonusPaise: MONTH_BONUS }),
					row('emp_kavya', { paidDays: 29, bonusWagesPaise: 6_766_67, bonusPaise: 56_366 }),
				]),
			],
		});
		const year = await service.bonusYear('2026-27');
		expect(year.rows.map((r) => [r.employeeId, r.daysWorked, r.duePaise])).toEqual([
			['emp_meera', 30, MONTH_BONUS],
			['emp_kavya', 29, 0],
		]);
		await service.payBonus('2026-27', { bankLedgerId: 'led_bank', paidOn: '2027-04-20' }, ca);
		const { lines } = ledger.post.mock.calls[0]?.[0] as unknown as {
			lines: { ledger: { id: string }; locationId: string; debitPaise?: number; creditPaise?: number }[];
		};
		// Kavya is paid nothing; her provision goes back from the payable to the year's bonus expense.
		expect(lines.slice(2)).toEqual([
			{ ledger: { id: 'led_bonus_payable' }, locationId: 'loc_bar', debitPaise: 56_366 },
			{ ledger: { id: 'led_bonus' }, locationId: 'loc_bar', creditPaise: 56_366 },
		]);
	});

	it('refuses a year with no bonus to pay, and posts as no one when no one is signed in', async () => {
		await expect(
			build({ runs: [] }).service.payBonus('2026-27', { bankLedgerId: 'led_bank', paidOn: '2027-04-20' }, ca),
		).rejects.toMatchObject(refusal('bonus_nothing'));
		const { service, ledger } = build({ runs: YEAR_RUNS });
		await service.payBonus('2026-27', { bankLedgerId: 'led_bank', paidOn: '2027-04-20' }, undefined);
		expect(ledger.post.mock.calls[0]?.[2]).toBeNull();
	});
});

describe('the bonus routes and rules (BN1)', () => {
	it('reads the year with accounts.index and pays it with accounts.post', async () => {
		const payroll = { bonusYear: vi.fn(async () => 'year'), payBonus: vi.fn(async () => 'paid') };
		const controller = new PayrollController(payroll as never);
		const pay = { bankLedgerId: 'led_bank', paidOn: '2027-04-20' };
		expect([
			await controller.bonusYear('2026-27'),
			await controller.payBonus('2026-27', pay, ca),
			await controller.payBonus('2026-27', pay),
		]).toEqual(['year', 'paid', 'paid']);
		expect(payroll.payBonus.mock.calls).toEqual([
			['2026-27', pay, ca],
			['2026-27', pay, undefined],
		]);
		const perm = (m: 'bonusYear' | 'payBonus') =>
			new Reflector().get(PERMISSIONS_KEY, PayrollController.prototype[m]);
		expect([perm('bonusYear'), perm('payBonus')]).toEqual([['accounts.index'], ['accounts.post']]);
		expect(Reflect.getMetadata('path', PayrollController.prototype.bonusYear)).toBe('bonus/:year');
		expect(Reflect.getMetadata('path', PayrollController.prototype.payBonus)).toBe('bonus/:year/pay');
	});

	it('uses the built-in figures for a version saved before bonus was part of the rules', async () => {
		const { bonus: _builtIn, ...withoutBonus } = BUILT_IN_PAYROLL_RULES;
		const older = { ...withoutBonus, id: 'prs_2026_10', builtIn: false, from: '2026-10-01' } as PayrollRulesVersion;
		// Brief 26 BN-D2: a copy with the law and wage basis set by the version's date (the Code, from October 2026).
		expect(rulesOf(older).bonus).toEqual(BONUS_2026);
		expect(rulesOf({ ...older, bonus: { ...BONUS_2026, ratePct: 20 } }).bonus.ratePct).toBe(20);
		const versions = await new PayrollRulesService(
			{ list: async () => [older] } as never,
			{ list: async () => [] } as never,
			{ append: async () => undefined } as never,
		).list();
		expect(versions.map((v) => [v.id, v.bonus])).toEqual([
			['prs_built_in', BUILT_IN_PAYROLL_RULES.bonus],
			['prs_2026_10', BONUS_2026],
		]);
	});
});
