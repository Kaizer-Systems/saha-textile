import type { Attendance, Employee, PayrollRow, PayrollRun } from '@saha-textile/contracts';
import { PayslipEditsInput } from '@saha-textile/contracts';
import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { BUILT_IN_PAYROLL_RULES, rulesOf } from '../src/payroll/payroll-rules.service';
import { PayrollService } from '../src/payroll/payroll.service';
import { applyEdits, byRulesOf, PayslipEditsController, PayslipEditsService } from '../src/payroll/payslip-edits';

/**
 * Brief 26 PE2: payslips edited on a draft run: worked out again from their lines, checked, kept when the draft is
 * prepared again, refused at approval while a blocking check stands, and posted with their added lines.
 */
const at = '2026-12-01T06:00:00.000Z';
const now = new Date(at);
const status = (error: unknown) => (error as { status?: number }).status;
const code = (error: unknown) => (error as { response?: { message?: string } }).response?.message;
const RULES = rulesOf({
	...BUILT_IN_PAYROLL_RULES,
	states: [
		{
			stateCode: '19',
			ptFrequency: 'monthly',
			ptSlabs: [
				{ upToPaise: 1_500_000, taxPaise: 11_000 },
				{ upToPaise: null, taxPaise: 15_000 },
			],
			ptMonths: [],
			ptDueDay: 21,
			lwfEmployeePaise: 0,
			lwfEmployerPaise: 0,
			lwfMonths: [],
			lwfDueDay: 15,
		},
	],
});

const employee = (id: string, locationId: string, over: Partial<Employee> = {}): Employee => ({
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
	structure: { basic: 10_000, da: 0, hra: 0, special: 6_000, conveyance: 0, other: 0 },
	advanceDueINR: 0,
	advancePerMonthINR: 0,
	createdAt: at,
	updatedAt: at,
	version: 0,
	...over,
});
const PRIYA = employee('emp_priya', 'loc_kolkata', {
	pfOn: true,
	esiOn: true,
	structure: { basic: 8_700, da: 0, hra: 3_480, special: 5_220, conveyance: 0, other: 0 },
});
const PEOPLE = [PRIYA];
/** People only the keep-figures rows name. */
const EXTRA = [
	{ ...PRIYA, id: 'emp_refused' },
	{ ...PRIYA, id: 'emp_broken' },
	{ ...PRIYA, id: 'emp_half' },
	{ ...PRIYA, id: 'emp_none' },
];
const ctx = { e: PRIYA, month: '2026-11', rules: RULES.pay, stateRules: RULES.states[0] ?? null };
const ATTENDANCE: Attendance = {
	month: '2026-11',
	daysInMonth: 30,
	rows: [{ employeeId: 'emp_priya', paidDays: 30, leaveTaken: 0, note: '' }],
	lockedAt: at,
	lockedBy: 'adm_clerk',
	version: 1,
};
const edits = (over: Record<string, unknown>) => PayslipEditsInput.parse(over);

/** A run prepared by the rules, its one row Priya's. */
function service(runOver: Partial<PayrollRun> = {}) {
	const store = new Map<string, PayrollRun>();
	const runs = {
		list: async () => [...store.values()],
		get: async (m: string) => store.get(m) ?? null,
		save: vi.fn(async (r: PayrollRun, expected: number | null) => {
			const saved = { ...r, version: expected === null ? 0 : expected + 1 };
			store.set(r.month, saved);
			return saved;
		}),
	};
	const ledger = {
		chart: async () => ({
			groups: [
				{ id: 'g_ind', systemKey: 'indirect_expenses' },
				{ id: 'g_cl', systemKey: 'current_liabilities' },
			],
			ledgers: [
				{ id: 'led_tds', groupId: 'g_cl', name: 'TDS payable', roles: ['tds_payable'] },
				{ id: 'led_advance', groupId: 'g_cl', name: 'Staff advances', roles: ['staff_advance'] },
			],
		}),
		addLedger: vi.fn(async (w: { name: string }) => ({ id: `led_${w.name}` })),
		post: vi.fn(async () => ({ id: 'jv_1' })),
	};
	const payroll = new PayrollService(
		{
			list: async () => PEOPLE,
			get: async (id: string) => PEOPLE.find((p) => p.id === id) ?? null,
			save: async (e: Employee) => e,
		} as never,
		{ get: async () => ATTENDANCE } as never,
		runs as never,
		ledger as never,
		{ withTransaction: async <T>(work: (context: unknown) => Promise<T>) => work({}) } as never,
		{ append: async () => undefined } as never,
		{ forMonth: async () => RULES } as never,
		{ list: async () => [{ id: 'loc_kolkata', stateCode: '19' }] } as never,
		{ issue: async () => 'PS/26-27/000001' } as never,
	);
	const audit = vi.fn(async () => undefined);
	const saved: Employee[] = [];
	const revisions = {
		accept: vi.fn(async (id: string) => {
			if (id === 'emp_refused') throw new BadRequestException({ message: 'revision_not_after_last' });
			if (id === 'emp_broken') throw new Error('disk full');
			return {};
		}),
	};
	const editor = new PayslipEditsService(
		runs as never,
		{
			get: async (id: string) => [...PEOPLE, ...EXTRA].find((p) => p.id === id) ?? null,
			save: vi.fn(async (e: Employee) => {
				saved.push(e);
				return e;
			}),
		} as never,
		{ forMonth: async () => RULES } as never,
		{ append: audit } as never,
		revisions as never,
	);
	return { payroll, editor, runs, store, ledger, audit, runOver, revisions, saved };
}

describe('a payslip edited on a draft (PE2)', () => {
	it('works the payslip out again from its lines, keeps the rules’ beside it, and its checks', async () => {
		const { payroll, editor, audit } = service();
		const run = await payroll.prepare('2026-11', now);
		const rulesRow = run.rows[0] as PayrollRow;
		const edited = await editor.edit(
			'2026-11',
			'emp_priya',
			edits({
				heads: { basic: 900_000 },
				added: [{ id: 'l1', kind: 'taxable', name: 'Shop incentive', paise: 50_000 }],
				reasons: { basic: 'Paid for the day marked absent in error' },
			}),
			{ userId: 'adm_acc' } as never,
			now,
		);
		const row = edited.rows[0] as PayrollRow;
		expect(row).toMatchObject({ grossPaise: 1_820_000, pfEmployeePaise: 108_000, ptPaise: 15_000, checks: [] });
		expect(row.byRules).toEqual(byRulesOf(rulesRow));
		expect(row.headsPaise?.basic).toBe(900_000);
		expect(audit).toHaveBeenCalledWith(
			expect.objectContaining({ action: 'payroll.payslip.edit', actorUserId: 'adm_acc' }),
		);
		// Undone, the payslip is the rules' again.
		const undone = await editor.edit('2026-11', 'emp_priya', edits({}), undefined, now);
		expect(undone.rows[0]).toMatchObject({ grossPaise: rulesRow.grossPaise, netPaise: rulesRow.netPaise });
		expect(undone.rows[0]?.edits).toBeUndefined();
	});

	it('keeps the edits when the draft is prepared again, and refuses approval while a blocking check stands', async () => {
		const { payroll, editor } = service();
		await payroll.prepare('2026-11', now);
		const blocked = await editor.edit(
			'2026-11',
			'emp_priya',
			edits({ deductions: { pf: 0 }, reasons: { pf: 'x' } }),
			undefined,
			now,
		);
		expect(blocked.rows[0]?.checks?.[0]).toMatchObject({ code: 'pf_below_law', blocking: true });
		const again = await payroll.prepare('2026-11', now);
		expect(again.rows[0]).toMatchObject({ pfEmployeePaise: 0, edits: { deductions: { pf: 0 } } });
		await expect(
			payroll.step(
				'2026-11',
				{ to: 'approved', bankLedgerId: null, paidOn: null, version: again.version },
				{ userId: 'adm_owner', permissions: ['accounts.lock'] } as never,
				now,
			),
		).rejects.toSatisfy((e) => code(e) === 'payroll_payslip_checks_blocking');
	});

	it('posts reimbursements and other deductions on their own ledgers', async () => {
		const { payroll, editor, ledger } = service();
		await payroll.prepare('2026-11', now);
		const run = await editor.edit(
			'2026-11',
			'emp_priya',
			edits({
				added: [
					{ id: 'a', kind: 'reimbursement', name: 'Travel', paise: 30_000 },
					{ id: 'b', kind: 'after_tax', name: 'Canteen', paise: 20_000 },
				],
			}),
			undefined,
			now,
		);
		const owner = { userId: 'adm_owner', permissions: ['accounts.lock'] } as never;
		const approved = await payroll.step(
			'2026-11',
			{ to: 'approved', bankLedgerId: null, paidOn: null, version: run.version },
			owner,
			now,
		);
		await payroll.step(
			'2026-11',
			{ to: 'posted', bankLedgerId: null, paidOn: null, version: approved.version },
			owner,
			now,
		);
		const lines = (
			ledger.post.mock.calls[0] as unknown as [
				{ lines: { ledger: { id: string }; debitPaise?: number; creditPaise?: number }[] },
			]
		)[0].lines;
		expect(lines).toContainEqual(
			expect.objectContaining({ ledger: { id: 'led_Staff reimbursements' }, debitPaise: 30_000 }),
		);
		expect(lines).toContainEqual(
			expect.objectContaining({ ledger: { id: 'led_Other salary deductions payable' }, creditPaise: 20_000 }),
		);
		const debits = lines.reduce((s, l) => s + (l.debitPaise ?? 0), 0);
		expect(debits).toBe(lines.reduce((s, l) => s + (l.creditPaise ?? 0), 0));
	});

	it('refuses a run not there, one not a draft, a person not on it; answers 409 on a save over another', async () => {
		const { payroll, editor, runs, store } = service();
		await expect(editor.edit('2026-11', 'emp_priya', edits({}), undefined)).rejects.toSatisfy(
			(e) => status(e) === 404,
		);
		await payroll.prepare('2026-11', now);
		await expect(editor.edit('2026-11', 'nobody', edits({}), undefined)).rejects.toSatisfy(
			(e) => status(e) === 404,
		);
		runs.save.mockRejectedValueOnce(new Error('payroll_run_changed'));
		await expect(editor.edit('2026-11', 'emp_priya', edits({}), undefined)).rejects.toSatisfy(
			(e) => status(e) === 409,
		);
		runs.save.mockRejectedValueOnce(new Error('disk full'));
		await expect(editor.edit('2026-11', 'emp_priya', edits({}), undefined)).rejects.toThrow('disk full');
		// A row whose person is gone is not edited; a row saved before States reads the person's own.
		const prepared = store.get('2026-11') as PayrollRun;
		const first = prepared.rows[0] as PayrollRow;
		store.set('2026-11', {
			...prepared,
			rows: [
				{ ...first, stateCode: undefined },
				{ ...first, employeeId: 'ghost' },
			],
		});
		await expect(editor.edit('2026-11', 'ghost', edits({}), undefined)).rejects.toSatisfy((e) => status(e) === 404);
		expect((await editor.edit('2026-11', 'emp_priya', edits({}), undefined)).rows[0]?.grossPaise).toBe(
			first.grossPaise,
		);
		store.set('2026-11', { ...(store.get('2026-11') as PayrollRun), status: 'approved' });
		await expect(editor.edit('2026-11', 'emp_priya', edits({}), undefined)).rejects.toSatisfy(
			(e) => code(e) === 'payroll_run_approved',
		);
	});
});

describe('applying edits to a row (PE2)', () => {
	const row = (over: Partial<PayrollRow> = {}) =>
		({
			employeeId: 'emp_priya',
			stateCode: '19',
			grossPaise: 1_740_000,
			pfWagesPaise: 870_000,
			pfEmployeePaise: 104_400,
			pfEmployerPaise: 104_400,
			epsPaise: 72_500,
			esiEmployeePaise: 13_100,
			esiEmployerPaise: 56_600,
			ptPaise: 15_000,
			tdsPaise: 0,
			advancePaise: 0,
			netPaise: 1_607_500,
			lwfEmployeePaise: 300,
			headsPaise: { basic: 870_000, hra: 348_000, special: 522_000 },
			...over,
		}) as PayrollRow;

	it('takes the welfare fund off the net, and the State’s tax on a changed gross (none without the State)', () => {
		const up = applyEdits(row(), edits({ heads: { special: 2_000_000 }, reasons: { special: 'x' } }), ctx);
		expect(up).toMatchObject({ ptPaise: 15_000 });
		expect(up.netPaise).toBe(up.grossPaise - up.pfEmployeePaise - up.esiEmployeePaise - 15_000 - 300);
		const down = applyEdits(row(), edits({ heads: { special: 0 }, reasons: { special: 'x' } }), ctx);
		expect(down.ptPaise).toBe(11_000);
		expect(
			applyEdits(row(), edits({ heads: { special: 0 }, reasons: { special: 'x' } }), { ...ctx, stateRules: null })
				.ptPaise,
		).toBe(0);
		const noLwf = applyEdits(
			row({ lwfEmployeePaise: undefined, headsPaise: undefined }),
			edits({ heads: { basic: 10 } }),
			ctx,
		);
		expect(noLwf.headsPaise).toMatchObject({ basic: 10, hra: 0 });
	});

	it('works a second edit from the payslip by the rules kept, not the edited one', () => {
		const once = applyEdits(row(), edits({ heads: { basic: 900_000 }, reasons: { basic: 'x' } }), ctx);
		const twice = applyEdits(once, edits({ heads: { hra: 400_000 }, reasons: { hra: 'x' } }), ctx);
		expect(twice.headsPaise).toMatchObject({ basic: 870_000, hra: 400_000 });
		expect(twice.byRules).toEqual(once.byRules);
	});

	it('hands the route to the service', () => {
		const svc = { edit: vi.fn() };
		const body = edits({});
		new PayslipEditsController(svc as never).edit({ month: '2026-11', employeeId: 'emp_priya' }, body, undefined);
		expect(svc.edit).toHaveBeenCalledWith('2026-11', 'emp_priya', body, undefined);
	});
});

describe('keeping the new figures as the salary (PE4, PE-D3)', () => {
	const row = (employeeId: string, over: Partial<PayrollRow>) =>
		({ employeeId, paidDays: 30, grossPaise: 0, netPaise: 0, ...over }) as PayrollRow;
	const published = (rows: PayrollRow[]): PayrollRun =>
		({ month: '2026-11', status: 'posted', rows, version: 3 }) as never;

	it('saves the heads typed and the lines added every month from next month, and an advance’s instalment typed', async () => {
		const { editor, store, revisions, saved } = service();
		store.set(
			'2026-11',
			published([
				row('emp_priya', {
					edits: edits({
						heads: { basic: 900_000 },
						added: [
							{ id: 'a', kind: 'taxable', name: 'Shop allowance', paise: 50_000, oneOff: false },
							{ id: 'b', kind: 'taxable', name: 'Diwali incentive', paise: 90_000, oneOff: true },
						],
						deductions: { advance: 50_000 },
					}),
				}),
				// 15 of 30 days paid: ₹4,500 typed is ₹9,000 for the month.
				row('emp_half', { paidDays: 15, edits: edits({ heads: { basic: 450_000 } }) }),
				row('emp_none', { paidDays: 0, edits: edits({ deductions: { advance: 10_000 } }) }),
				row('emp_refused', { edits: edits({ heads: { basic: 1 } }) }),
				row('emp_broken', { edits: edits({ heads: { basic: 1 } }) }),
				row('emp_plain', {}),
			]),
		);
		const results = await editor.keep(
			'2026-11',
			['emp_priya', 'emp_half', 'emp_none', 'emp_refused', 'emp_broken', 'emp_plain'],
			{ userId: 'adm_acc' } as never,
			now,
		);
		expect(results.map((r) => [r.employeeId, r.ok, r.problem])).toEqual([
			['emp_priya', true, null],
			['emp_half', true, null],
			['emp_none', true, null],
			['emp_refused', false, 'revision_not_after_last'],
			['emp_broken', false, 'failed'],
			['emp_plain', false, 'payroll_row_not_found'],
		]);
		const first = revisions.accept.mock.calls[0] as unknown as [
			string,
			{ way: { structure: Record<string, number> }; from: string },
		];
		expect(first[0]).toBe('emp_priya');
		expect(first[1]).toMatchObject({
			from: '2026-12-01',
			way: { kind: 'heads', structure: { basic: 9_000, other: 500 } },
		});
		const half = revisions.accept.mock.calls[1] as unknown as [
			string,
			{ way: { structure: Record<string, number> } },
		];
		expect(half[1].way.structure.basic).toBe(9_000);
		expect(revisions.accept.mock.calls.map((c) => c[0])).not.toContain('emp_none');
		expect(saved.map((e) => [e.id, e.advancePerMonthINR])).toEqual([
			['emp_priya', 500],
			['emp_none', 100],
		]);
	});

	it('refuses a run not there or not published yet, and hands the route to the service', async () => {
		const { editor, payroll } = service();
		await expect(editor.keep('2026-11', ['emp_priya'], undefined)).rejects.toSatisfy((e) => status(e) === 404);
		await payroll.prepare('2026-11', now);
		await expect(editor.keep('2026-11', ['emp_priya'], undefined)).rejects.toSatisfy(
			(e) => code(e) === 'payroll_run_not_published',
		);
		const svc = { keep: vi.fn() };
		new PayslipEditsController(svc as never).keep('2026-11', { employeeIds: ['emp_priya'] }, undefined);
		expect(svc.keep).toHaveBeenCalledWith('2026-11', ['emp_priya'], undefined);
	});
});
