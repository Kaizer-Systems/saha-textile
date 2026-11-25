import type { Employee, PayrollRun, SalaryRevisionInputValue, SalaryTemplate } from '@saha-textile/contracts';
import { SalaryRevisionInput } from '@saha-textile/contracts';
import { describe, expect, it, vi } from 'vitest';

import { BUILT_IN_PAYROLL_RULES, rulesOf } from '../src/payroll/payroll-rules.service';
import { SalaryRevisionsController, SalaryRevisionsService } from '../src/payroll/salary-revisions';

/**
 * Brief 26 SR2, SR4: revising one person: by 8%, by an amount, to a new CTC, or head by head; heads typed over with
 * the CTC locked or following; arrears for months already paid; the checks; and Accept keeping the old salary.
 */

const at = '2026-11-26T06:00:00.000Z';
const now = new Date(at);
const status = (error: unknown) => (error as { status?: number }).status;
const code = (error: unknown) => (error as { response?: { message?: string } }).response?.message;

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
/** The brief's store staff structure, built from the yearly CTC. */
const STORE_STAFF = {
	id: 'tpl_store',
	name: 'Store staff',
	basis: 'ctc',
	examplePayINR: 20_000,
	components: [
		{ head: 'basic', how: 'percent', value: 45 },
		{ head: 'da', how: 'percent_basic', value: 10 },
		{ head: 'hra', how: 'percent_basic', value: 40 },
		{ head: 'conveyance', how: 'fixed', value: 1_600 },
		{ head: 'special', how: 'rest', value: 0 },
	],
} as SalaryTemplate;
const PRIYA_PAY = { basic: 13_500, da: 1_350, hra: 5_400, conveyance: 1_600, special: 5_701, other: 0 };
const WB = rulesOf({
	...BUILT_IN_PAYROLL_RULES,
	states: [
		{
			stateCode: '19',
			ptFrequency: 'monthly',
			ptSlabs: [
				{ upToPaise: 2_500_000, taxPaise: 13_000 },
				{ upToPaise: null, taxPaise: 20_000 },
			],
			ptMonths: [],
			ptDueDay: 21,
			lwfEmployeePaise: 0,
			lwfEmployerPaise: 0,
			lwfMonths: [],
			lwfDueDay: 15,
			minimumWages: [{ from: '2026-07-01', levels: { skilled: 1_600_000 } }],
		},
	],
});
const paidRun = (month: string, s: PayrollRun['status'] = 'paid'): PayrollRun =>
	({ month, status: s, rows: [{ employeeId: 'emp_priya', paidDays: month === '2026-10' ? 31 : 30 }] }) as never;

function build(person: Employee, options: { saveFails?: Error } = {}) {
	const saved: Employee[] = [];
	const audit = vi.fn(async () => undefined);
	const service = new SalaryRevisionsService(
		{
			get: async (id: string) => (id === person.id ? person : null),
			save: vi.fn(async (e: Employee) => {
				if (options.saveFails) throw options.saveFails;
				saved.push(e);
				return { ...e, version: e.version + 1 };
			}),
		} as never,
		{
			get: async (id: string) =>
				id === 'tpl_store'
					? STORE_STAFF
					: id === 'tpl_norest'
						? { ...STORE_STAFF, components: STORE_STAFF.components.filter((c) => c.how !== 'rest') }
						: null,
		} as never,
		{ forMonth: async () => WB } as never,
		{
			list: async () => [paidRun('2026-09'), paidRun('2026-10'), paidRun('2026-11', 'draft'), paidRun('2026-08')],
		} as never,
		{ list: async () => [{ id: 'loc_kolkata', stateCode: '19' }] } as never,
		{ append: audit } as never,
	);
	return { service, saved, audit };
}
const PRIYA = employee('emp_priya', 'loc_kolkata', {
	pfOn: true,
	esiOn: true,
	structure: PRIYA_PAY,
	ctcYearINR: 360_000,
	templateId: 'tpl_store',
});
const ask = (over: SalaryRevisionInputValue) =>
	SalaryRevisionInput.parse({ from: '2026-12-01', reason: 'Annual increment, rating A', ...over });

describe('revising one person (SR2)', () => {
	it('gives the brief’s breakup for 8%: the heads re-split under the structure, the CTC up ₹2,400', async () => {
		const { service } = build(PRIYA);
		const p = await service.preview('emp_priya', ask({ way: { kind: 'percent', pct: 8 } }));
		expect(p.now).toMatchObject({ grossINR: 27_551, employerINR: 2_449, ctcMonthINR: 30_000 });
		expect(p.next).toMatchObject({
			structure: { basic: 14_580, da: 1_458, hra: 5_832, conveyance: 1_600, special: 6_359, other: 0 },
			// The employer's share as the run provides it: PF at the ₹15,000 ceiling, gratuity on Basic and DA.
			grossINR: 29_829,
			employerINR: 1_800 + 771,
			ctcMonthINR: 32_400,
		});
		expect(p.lines.find((l) => l.head === 'special')).toEqual({
			head: 'special',
			nowINR: 5_701,
			nextINR: 6_359,
			changeINR: 658,
		});
		expect([p.changePct, p.decrease, p.arrears, p.checks]).toEqual([8, false, null, []]);
		// Take-home: the gross less PF ₹1,800 and the State's ₹200.
		expect(p.next.takeHomeINR).toBe(29_829 - 1_800 - 200);
	});

	it('takes an amount, a new CTC, or the heads typed; a typed head moves the rest under a locked CTC, or the CTC', async () => {
		const { service } = build(PRIYA);
		const amount = await service.preview('emp_priya', ask({ way: { kind: 'amount', monthINR: 2_400 } }));
		const ctc = await service.preview('emp_priya', ask({ way: { kind: 'ctc', yearINR: 388_800 } }));
		expect([amount.next.ctcMonthINR, ctc.next.ctcMonthINR]).toEqual([32_400, 32_400]);
		const heads = await service.preview(
			'emp_priya',
			ask({ way: { kind: 'heads', structure: { ...PRIYA_PAY, hra: 6_000 } } }),
		);
		// PF on ₹14,850 is under the ceiling (₹1,782); gratuity ₹714 on Basic and DA.
		expect(heads.next).toMatchObject({ grossINR: 28_151, ctcMonthINR: 28_151 + 1_782 + 714 });
		const locked = await service.preview(
			'emp_priya',
			ask({ way: { kind: 'percent', pct: 8 }, typed: { hra: 6_000 } }),
		);
		expect(locked.next).toMatchObject({ ctcMonthINR: 32_400, structure: { hra: 6_000, special: 6_191 } });
		const free = await service.preview(
			'emp_priya',
			ask({ way: { kind: 'percent', pct: 8 }, typed: { hra: 6_000 }, lockCtc: false }),
		);
		expect(free.next.ctcMonthINR).toBe(32_568);
	});

	it('splits by the person’s own structure without a CTC template, the CTC worked from the pay', async () => {
		const plain = employee('emp_plain', 'loc_far', { structure: { ...PRIYA_PAY, special: 0, other: 5_701 } });
		const p = await build(plain).service.preview('emp_plain', ask({ way: { kind: 'percent', pct: 10 } }));
		// No PF or ESI for this person: the gross and the gratuity provision.
		expect(p.now.ctcMonthINR).toBe(27_551 + 714);
		expect(p.next.structure.other).toBeGreaterThan(5_701);
		const onlyBasic = employee('emp_basic', 'loc_far', {
			structure: { ...PRIYA_PAY, da: 0, hra: 0, conveyance: 0, special: 0 },
		});
		expect(
			(await build(onlyBasic).service.preview('emp_basic', ask({ way: { kind: 'percent', pct: 10 } }))).next
				.structure.basic,
		).toBe(14_850);
		const convOnly = employee('emp_conv', 'loc_far', { structure: { ...PRIYA_PAY, special: 0, hra: 0 } });
		expect(
			(await build(convOnly).service.preview('emp_conv', ask({ way: { kind: 'percent', pct: 10 } }))).lines.map(
				(l) => l.head,
			),
		).toContain('conveyance');
	});

	it('pays arrears for months already paid from the revision’s day, with the month after the last one paid', async () => {
		const p = await build(PRIYA).service.preview(
			'emp_priya',
			ask({ way: { kind: 'percent', pct: 8 }, from: '2026-09-01' }),
		);
		expect(p.arrears).toEqual({ inr: 2_278 * 2, months: ['2026-09', '2026-10'], paidIn: '2026-11' });
	});

	it('checks: the rest below nothing, a decrease without agreement, under the minimum wage, wages under half', async () => {
		const skilled = employee('emp_s', 'loc_kolkata', { ...PRIYA, id: 'emp_s', skillLevel: 'skilled' });
		const { service } = build(skilled);
		const over = await service.preview('emp_s', ask({ way: { kind: 'percent', pct: 0 }, typed: { hra: 40_000 } }));
		expect(over.checks.map((c) => [c.code, c.blocking])).toContainEqual(['rest_below_zero', true]);
		const down = await service.preview('emp_s', ask({ way: { kind: 'percent', pct: -10 } }));
		expect(down.decrease).toBe(true);
		expect(down.checks).toEqual([
			{ code: 'decrease_needs_agreement', blocking: true, inr: 0 },
			{ code: 'below_minimum_wage', blocking: false, inr: 16_000 - 12_150 - 1_215 },
		]);
		const thin = await service.preview(
			'emp_s',
			ask({ way: { kind: 'heads', structure: { ...PRIYA_PAY, basic: 20_000, da: 0, hra: 0, special: 30_000 } } }),
		);
		// Basic ₹20,000 of ₹51,600: ₹5,800 of the allowances counts as wages.
		expect(thin.checks).toContainEqual({ code: 'wages_under_half', blocking: false, inr: 5_800 });
		const agreed = await service.preview('emp_s', ask({ way: { kind: 'percent', pct: -10 }, agreed: true }));
		expect(agreed.checks.map((c) => c.code)).not.toContain('decrease_needs_agreement');
	});
});

describe('the edges of a revision', () => {
	it('charges no professional tax where the State has no rules, and keeps the special allowance as the rest', async () => {
		const far = employee('emp_far', 'loc_far', { ptState: '27', structure: PRIYA_PAY, templateId: 'tpl_norest' });
		const { service, saved } = build(far);
		const p = await service.preview('emp_far', ask({ way: { kind: 'percent', pct: 8 }, typed: { hra: 6_000 } }));
		expect(p.next.takeHomeINR).toBe(p.next.grossINR);
		expect(p.next.structure.hra).toBe(6_000);
		// A CTC structure with no rest leaves part of the CTC unspent, which reads as a decrease: agreed here.
		await service.accept('emp_far', ask({ way: { kind: 'percent', pct: 8 }, agreed: true }), undefined, now);
		expect(saved[0]?.salaryHistory?.[0]?.ctcYearINR).toBeNull();
	});

	it('shows no change in % for someone paid nothing yet', async () => {
		const none = { basic: 0, da: 0, hra: 0, special: 0, conveyance: 0, other: 0 };
		const p = await build(employee('emp_new', 'loc_far', { structure: none })).service.preview(
			'emp_new',
			ask({ way: { kind: 'amount', monthINR: 10_000 } }),
		);
		expect([p.changePct, p.next.ctcMonthINR]).toEqual([0, 10_000]);
	});
});

describe('accepting a revision (SR2)', () => {
	it('keeps the old salary from the joining day, saves the new from its day, and writes the audit record', async () => {
		const { service, saved, audit } = build(PRIYA);
		await service.accept(
			'emp_priya',
			ask({ way: { kind: 'percent', pct: 8 } }),
			{ userId: 'adm_acc' } as never,
			now,
		);
		expect(saved[0]).toMatchObject({
			structure: { basic: 14_580, special: 6_359 },
			ctcYearINR: 388_800,
			templateId: 'tpl_store',
		});
		expect(saved[0]?.salaryHistory?.map((v) => [v.from, v.structure.basic, v.acceptedBy])).toEqual([
			['2025-04-01', 13_500, null],
			['2026-12-01', 14_580, 'adm_acc'],
		]);
		expect(audit).toHaveBeenCalledWith(
			expect.objectContaining({ action: 'payroll.salary.revise', entityId: 'emp_priya' }),
		);
	});

	it('adds to a history already kept, names the month arrears go with, and refuses a day not after the last', async () => {
		const revised = {
			...PRIYA,
			templateId: null,
			salaryHistory: [
				{
					from: '2025-04-01',
					structure: PRIYA_PAY,
					ctcYearINR: 360_000,
					reason: '',
					decrease: false,
					acceptedBy: null,
					acceptedAt: at,
					arrearsPaidIn: null,
				},
			],
		};
		const { service, saved } = build(revised);
		await service.accept(
			'emp_priya',
			ask({ way: { kind: 'percent', pct: 8 }, from: '2026-09-01' }),
			undefined,
			now,
		);
		expect(saved[0]?.salaryHistory?.at(-1)).toMatchObject({
			from: '2026-09-01',
			acceptedBy: null,
			arrearsPaidIn: '2026-11',
		});
		expect(saved[0]?.templateId).toBeNull();
		await expect(
			service.accept('emp_priya', ask({ way: { kind: 'percent', pct: 8 }, from: '2025-04-01' }), undefined, now),
		).rejects.toSatisfy((e) => code(e) === 'revision_not_after_last');
	});

	it('refuses a blocking check, an unknown person, a save over another; passes any other failure on', async () => {
		const { service } = build(PRIYA);
		await expect(
			service.accept('emp_priya', ask({ way: { kind: 'percent', pct: -5 } }), undefined, now),
		).rejects.toSatisfy((e) => code(e) === 'revision_decrease_needs_agreement');
		await expect(service.preview('nobody', ask({ way: { kind: 'percent', pct: 5 } }))).rejects.toSatisfy(
			(e) => status(e) === 404,
		);
		const conflict = build(PRIYA, { saveFails: new Error('employee_changed') }).service;
		await expect(conflict.accept('emp_priya', ask({ way: { kind: 'percent', pct: 5 } }))).rejects.toSatisfy(
			(e) => status(e) === 409,
		);
		const broken = build(PRIYA, { saveFails: new Error('disk full') }).service;
		await expect(broken.accept('emp_priya', ask({ way: { kind: 'percent', pct: 5 } }))).rejects.toThrow(
			'disk full',
		);
	});

	it('hands each route to the service', () => {
		const service = { preview: vi.fn(), accept: vi.fn() };
		const c = new SalaryRevisionsController(service as never);
		const body = ask({ way: { kind: 'percent', pct: 5 } });
		c.preview('emp_priya', body);
		c.accept('emp_priya', body, { userId: 'adm_acc' } as never);
		expect(service.preview).toHaveBeenCalledWith('emp_priya', body);
		expect(service.accept).toHaveBeenCalledWith('emp_priya', body, { userId: 'adm_acc' });
	});
});
