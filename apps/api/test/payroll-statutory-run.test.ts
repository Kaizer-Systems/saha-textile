import type { Attendance, Employee, PayrollRow, PayrollRun } from '@saha-textile/contracts';
import { describe, expect, it, vi } from 'vitest';

import { BUILT_IN_PAYROLL_RULES, rulesOf } from '../src/payroll/payroll-rules.service';
import { PayrollService, allocate } from '../src/payroll/payroll.service';

/** The run with the schemes (accounts brief S2, S5): welfare fund, gratuity, the EPF charges, and older runs. */

const at = '2026-12-31T06:00:00.000Z';
const now = new Date(at);
const ca = { userId: 'adm_ca', permissions: ['accounts.post', 'accounts.lock'] } as never;
const step = (
	to: 'approved' | 'posted' | 'paid',
	version: number,
	bank: Partial<{ bankLedgerId: string; paidOn: string }> = {},
) => ({
	to,
	version,
	bankLedgerId: bank.bankLedgerId ?? null,
	paidOn: bank.paidOn ?? null,
});

/** Ten people at ₹18,000 a month: gratuity applies from ten. */
const TEN = Array.from({ length: 10 }, (_, i) => ({
	id: `emp_${i}`,
	name: `Person ${String(i).padStart(2, '0')}`,
	code: '',
	designation: '',
	department: '',
	userId: null,
	locationId: i < 7 ? 'loc_bar' : 'loc_shop',
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
	pfOn: true,
	esiOn: true,
	structure: { basic: 9_000, da: 0, hra: 0, special: 9_000, conveyance: 0, other: 0 },
	advanceDueINR: 0,
	advancePerMonthINR: 0,
	createdAt: at,
	updatedAt: at,
	version: 0,
})) as Employee[];
const locked = (month: string, days: number, people = TEN): Attendance => ({
	month,
	daysInMonth: days,
	rows: people.map((e) => ({ employeeId: e.id, paidDays: days, leaveTaken: 0, note: '' })),
	lockedAt: at,
	lockedBy: 'adm_clerk',
	version: 1,
});

function build(options: { employees?: Employee[]; attendance?: Attendance[]; runs?: PayrollRun[] } = {}) {
	const people = new Map((options.employees ?? TEN).map((e) => [e.id, e]));
	const months = new Map((options.attendance ?? []).map((a) => [a.month, a]));
	const runStore = new Map((options.runs ?? []).map((r) => [r.month, r]));
	const chart = {
		groups: [
			{ id: 'g_ind', systemKey: 'indirect_expenses' },
			{ id: 'g_cl', systemKey: 'current_liabilities' },
			{ id: 'g_prov', systemKey: 'provisions' },
		],
		ledgers: [
			{ id: 'led_tds', groupId: 'g_cl', name: 'TDS payable', roles: ['tds_payable'] },
			{ id: 'led_advance', groupId: 'g_ca', name: 'Staff advances', roles: ['staff_advance'] },
		] as Record<string, unknown>[],
	};
	const ledger = {
		chart: async () => chart,
		addLedger: vi.fn(async (write: { name: string; groupId: string }, _by: string | null) => {
			const made = {
				id: `led_${write.name.toLowerCase().replace(/\W+/g, '_')}`,
				groupId: write.groupId,
				name: write.name,
				roles: [],
			};
			chart.ledgers.push(made);
			return made;
		}),
		post: vi.fn(async (_request: unknown, _context: unknown, _by: string | null) => ({
			id: `jv_${ledger.post.mock.calls.length}`,
		})),
	};
	const service = new PayrollService(
		{
			list: async () => [...people.values()],
			get: async (id: string) => people.get(id) ?? null,
			save: async (e: Employee) => e,
		} as never,
		{ get: async (month: string) => months.get(month) ?? null } as never,
		{
			list: async () => [...runStore.values()],
			get: async (month: string) => runStore.get(month) ?? null,
			save: async (r: PayrollRun, expected: number | null) => {
				const saved = { ...r, version: expected === null ? 0 : expected + 1 };
				runStore.set(r.month, saved);
				return saved;
			},
		} as never,
		ledger as never,
		{ withTransaction: async <T>(work: (context: unknown) => Promise<T>) => work({ session: 'tx' }) } as never,
		{ append: async () => undefined } as never,
		{ forMonth: async () => rulesOf(BUILT_IN_PAYROLL_RULES) } as never,
		{ list: async () => [] } as never,
		{ issue: async () => 'PS/26-27/000001' } as never,
	);
	return { service, ledger, runStore };
}

type Line = { ledger: { id: string }; locationId: string; debitPaise?: number; creditPaise?: number };
const linesOf = (ledger: ReturnType<typeof build>['ledger'], call = 0) =>
	(ledger.post.mock.calls[call]?.[0] as { lines: Line[] }).lines;
const total = (lines: Line[], id: string, side: 'debitPaise' | 'creditPaise') =>
	lines.filter((l) => l.ledger.id === id).reduce((s, l) => s + (l[side] ?? 0), 0);

describe('sharing a total by weights', () => {
	it('gives each share whole rupees, the remainder on the last share with weight, and nothing without weight', () => {
		// The EPF charges of ₹734 by capped wages of ₹38,700 and ₹8,000.
		expect(allocate(73_400, [3_870_000, 800_000, 0])).toEqual([60_800, 12_600, 0]);
		expect(allocate(73_400, [0, 0])).toEqual([0, 0]);
	});
});

describe('the welfare fund and gratuity in the run (S2)', () => {
	it('takes the welfare fund in December, provides gratuity once ten are on the roll, and keeps each head and the charges', async () => {
		const { service } = build({ attendance: [locked('2026-12', 31), locked('2026-11', 30)] });
		const november = await service.prepare('2026-11', now);
		const december = await service.prepare('2026-12', now);
		const [nov, dec] = [november.rows[0] as PayrollRow, december.rows[0] as PayrollRow];
		expect(nov).toMatchObject({ lwfEmployeePaise: 0, lwfEmployerPaise: 0 });
		expect(dec).toMatchObject({ lwfEmployeePaise: 300, lwfEmployerPaise: 1_500, netPaise: nov.netPaise - 300 });
		expect(dec.gratuityPaise).toBeGreaterThan(0);
		expect(dec.headsPaise).toEqual({ basic: 900_000, da: 0, hra: 0, conveyance: 0, special: 900_000, other: 0 });
		expect(december).toMatchObject({ schemesFrom: '2026-04-01', edliPaise: 45_000 });
		// 0.5% of ten capped wages of ₹9,000 is ₹450, under the ₹500 minimum.
		expect(december.pfAdminPaise).toBe(50_000);
	});

	it('provides no gratuity with fewer than ten on the roll', async () => {
		const nine = TEN.slice(0, 9);
		const { service } = build({ employees: nine, attendance: [locked('2026-12', 31, nine)] });
		const run = await service.prepare('2026-12', now);
		expect(run.rows.every((r) => r.gratuityPaise === 0)).toBe(true);
	});

	it('posts the welfare fund and gratuity, making their ledgers, and shares the EPF charges by location', async () => {
		const { service, ledger } = build({ attendance: [locked('2026-12', 31)] });
		const run = await service.prepare('2026-12', now);
		await service.step('2026-12', step('approved', 0), ca, now);
		await service.step('2026-12', step('posted', 1), ca, now);
		const made = ledger.addLedger.mock.calls.map(([write]) => write.name);
		expect(made).toEqual(
			expect.arrayContaining([
				'Employer labour welfare fund',
				'Labour welfare fund payable',
				'Gratuity',
				'Provision for gratuity',
			]),
		);
		const lines = linesOf(ledger);
		expect(total(lines, 'led_employer_labour_welfare_fund', 'debitPaise')).toBe(15_000);
		expect(total(lines, 'led_labour_welfare_fund_payable', 'creditPaise')).toBe(18_000);
		const gratuity = run.rows.reduce((s, r) => s + (r.gratuityPaise ?? 0), 0);
		expect(total(lines, 'led_gratuity', 'debitPaise')).toBe(gratuity);
		expect(total(lines, 'led_provision_for_gratuity', 'creditPaise')).toBe(gratuity);
		// The charges of ₹950 (₹500 admin, ₹450 EDLI) by PF wages: seven at the bar, three at the shop.
		const charges = (place: string) =>
			lines.filter((l) => l.ledger.id === 'led_employer_pf_contribution' && l.locationId === place)[0]
				?.debitPaise ?? 0;
		const employerPf = (place: string) =>
			run.rows.filter((r) => r.locationId === place).reduce((s, r) => s + r.pfEmployerPaise, 0);
		expect([charges('loc_bar') - employerPf('loc_bar'), charges('loc_shop') - employerPf('loc_shop')]).toEqual([
			66_500, 28_500,
		]);
		const side = (s: 'debitPaise' | 'creditPaise') => lines.reduce((sum, l) => sum + (l[s] ?? 0), 0);
		expect(side('debitPaise')).toBe(side('creditPaise'));
	});

	it('records the day salaries were paid', async () => {
		const { service, runStore } = build({ attendance: [locked('2026-12', 31)] });
		await service.prepare('2026-12', now);
		await service.step('2026-12', step('approved', 0), ca);
		await service.step('2026-12', step('posted', 1), ca);
		await service.step('2026-12', step('paid', 2, { bankLedgerId: 'led_hdfc', paidOn: '2027-01-01' }), ca);
		expect(runStore.get('2026-12')).toMatchObject({ status: 'paid', paidOn: '2027-01-01' });
	});
});

describe('posting a run made before the schemes were kept', () => {
	const older = (rows: Partial<PayrollRow>[]): PayrollRun =>
		({
			id: 'pay_old',
			month: '2026-11',
			status: 'approved',
			rows: rows.map((r, i) => ({
				employeeId: `emp_${i}`,
				name: `Person ${i}`,
				locationId: 'loc_bar',
				paidDays: 30,
				grossPaise: 1_800_000,
				pfWagesPaise: 900_000,
				pfEmployeePaise: 108_000,
				pfEmployerPaise: 108_000,
				epsPaise: 75_000,
				esiEmployeePaise: 13_500,
				esiEmployerPaise: 58_500,
				ptPaise: 13_000,
				tdsPaise: 0,
				advancePaise: 0,
				netPaise: 1_565_500,
				...r,
			})),
			rulesFrom: '2026-04-01',
			voucherId: null,
			payVoucherId: null,
			approvedBy: 'adm_ca',
			approvedAt: at,
			createdAt: at,
			updatedAt: at,
			version: 1,
		}) as PayrollRun;

	it('posts no welfare fund, gratuity or EPF charges it never kept, and someone off PF takes no share', async () => {
		const { service, ledger } = build({
			runs: [older([{}, { pfEmployeePaise: 0, pfEmployerPaise: 0, epsPaise: 0 }])],
		});
		await service.step('2026-11', step('posted', 1), ca);
		const names = ledger.addLedger.mock.calls.map(([write]) => write.name);
		expect(names).not.toContain('Gratuity');
		expect(names).not.toContain('Labour welfare fund payable');
		const lines = linesOf(ledger);
		expect(total(lines, 'led_employer_pf_contribution', 'debitPaise')).toBe(108_000);
		expect(lines.some((l) => l.ledger.id === '')).toBe(false);
	});

	it('shares nothing when nobody in the run is on PF', async () => {
		const { service, ledger } = build({ runs: [older([{ pfEmployeePaise: 0, pfEmployerPaise: 0, epsPaise: 0 }])] });
		await service.step('2026-11', step('posted', 1), ca);
		expect(total(linesOf(ledger), 'led_employer_pf_contribution', 'debitPaise')).toBe(0);
	});
});
