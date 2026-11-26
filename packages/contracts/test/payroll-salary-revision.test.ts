import { describe, expect, it } from 'vitest';

import {
	Employee,
	EmployeeWrite,
	IncrementPlan,
	IncrementPlanWrite,
	IncrementRowPreview,
	IncrementRowResult,
	IncrementRowsInput,
	MinimumWagesSet,
	RevisionWay,
	SalaryRevisionInput,
	SalaryRevisionPreview,
	SalaryTemplateWrite,
	SalaryVersion,
	SkillLevel,
	StatePayrollRules,
	StructureComponentWrite,
} from '../src/payroll';

/** Revising pay (brief 26 SR1–SR4): CTC structures, dated salaries, minimum wages by skill, and a revision's breakup. */

const accepted = (input: unknown) => expect(input).toBe(true);
const refused = (input: unknown) => expect(input).toBe(false);

const structure = { basic: 12_000, da: 0, hra: 4_800, special: 5_200, conveyance: 1_600, other: 0 };
const employee = { name: 'Priya Das', locationId: 'loc_kolkata', joinedOn: '2024-06-01', structure: { basic: 9_000 } };

describe('structures built from the CTC (SR1)', () => {
	it('takes a share of Basic as a way to set a head', () => {
		expect(StructureComponentWrite.parse({ head: 'hra', how: 'percent_basic', value: 40 })).toEqual({
			head: 'hra',
			how: 'percent_basic',
			value: 40,
		});
	});

	it('builds a template from the gross as before, or from the yearly CTC shown on an example', () => {
		const components = [
			{ head: 'basic', how: 'percent', value: 50 },
			{ head: 'hra', how: 'percent_basic', value: 40 },
			{ head: 'special', how: 'rest' },
		];
		const older = SalaryTemplateWrite.parse({ name: 'Shop staff', components });
		expect(older).not.toHaveProperty('basis');
		expect(older).not.toHaveProperty('exampleCtcYearINR');
		const ctc = SalaryTemplateWrite.parse({
			name: 'Managers',
			basis: 'ctc',
			exampleCtcYearINR: 6_00_000,
			components,
		});
		expect([ctc.basis, ctc.exampleCtcYearINR]).toEqual(['ctc', 6_00_000]);
		accepted(SalaryTemplateWrite.safeParse({ name: 'Shop staff', basis: 'gross', components }).success);
		refused(SalaryTemplateWrite.safeParse({ name: 'Shop staff', basis: 'net', components }).success);
		refused(SalaryTemplateWrite.safeParse({ name: 'Shop staff', exampleCtcYearINR: -1, components }).success);
		// A share of Basic is not a share of the pay: 50% of pay and 60% of Basic stay within 100%.
		accepted(
			SalaryTemplateWrite.safeParse({
				name: 'Shop staff',
				components: [
					{ head: 'basic', how: 'percent', value: 50 },
					{ head: 'hra', how: 'percent_basic', value: 60 },
					{ head: 'special', how: 'rest' },
				],
			}).success,
		);
	});

	it('keeps an employee’s template, yearly CTC and skill level, none until given', () => {
		const parsed = EmployeeWrite.parse(employee);
		for (const key of ['templateId', 'ctcYearINR', 'skillLevel']) expect(parsed).not.toHaveProperty(key);
		const set = { templateId: 'sst_managers', ctcYearINR: 6_00_000, skillLevel: 'semi_skilled' };
		expect(EmployeeWrite.parse({ ...employee, ...set })).toMatchObject(set);
		expect(
			EmployeeWrite.parse({ ...employee, templateId: null, ctcYearINR: null, skillLevel: null }),
		).toMatchObject({ templateId: null, ctcYearINR: null, skillLevel: null });
		refused(EmployeeWrite.safeParse({ ...employee, skillLevel: 'expert' }).success);
		refused(EmployeeWrite.safeParse({ ...employee, ctcYearINR: -1 }).success);
	});
});

describe('dated salaries (SR2)', () => {
	const version = { from: '2026-04-01', structure, acceptedAt: '2026-03-25T06:00:00.000Z' };

	it('keeps a salary from a day, from the gross unless a CTC is said, with no reason, no decrease and no arrears paid until set', () => {
		expect(SalaryVersion.parse(version)).toEqual({
			...version,
			ctcYearINR: null,
			reason: '',
			decrease: false,
			acceptedBy: null,
			arrearsPaidIn: null,
		});
		const full = {
			...version,
			ctcYearINR: 3_60_000,
			reason: 'Annual increment',
			decrease: false,
			acceptedBy: 'adm_owner',
			arrearsPaidIn: '2026-06',
		};
		expect(SalaryVersion.parse(full)).toEqual(full);
	});

	it('refuses a reason over 300 letters, a month not YYYY-MM for the arrears, and a salary nobody accepted on a day', () => {
		refused(SalaryVersion.safeParse({ ...version, reason: 'x'.repeat(301) }).success);
		refused(SalaryVersion.safeParse({ ...version, arrearsPaidIn: '2026-6' }).success);
		refused(SalaryVersion.safeParse({ ...version, acceptedAt: undefined }).success);
		refused(SalaryVersion.safeParse({ ...version, structure: { da: 100 } }).success);
		refused(SalaryVersion.safeParse({ ...version, acceptedBy: '' }).success);
	});

	it('keeps up to 200 earlier salaries on an employee, none before revisions began', () => {
		const kept = {
			...employee,
			id: 'emp_priya',
			createdAt: '2024-06-01T05:00:00.000Z',
			updatedAt: '2026-04-01T05:00:00.000Z',
			version: 3,
		};
		expect(Employee.parse(kept)).not.toHaveProperty('salaryHistory');
		expect(Employee.parse({ ...kept, salaryHistory: [version] }).salaryHistory).toHaveLength(1);
		accepted(Employee.safeParse({ ...kept, salaryHistory: Array.from({ length: 200 }, () => version) }).success);
		refused(Employee.safeParse({ ...kept, salaryHistory: Array.from({ length: 201 }, () => version) }).success);
	});
});

describe('minimum wages by skill (SR4)', () => {
	it('knows four skill levels', () => {
		expect(SkillLevel.options).toEqual(['unskilled', 'semi_skilled', 'skilled', 'highly_skilled']);
	});

	it('keeps a State’s minimum wages a month from a notification’s day, any level left out, in whole paise', () => {
		const set = {
			from: '2026-07-01',
			levels: { unskilled: 9_826_00, semi_skilled: 10_809_00, skilled: 11_890_00 },
		};
		expect(MinimumWagesSet.parse(set)).toEqual(set);
		expect(MinimumWagesSet.parse({ from: '2026-07-01', levels: {} }).levels).toEqual({});
		refused(MinimumWagesSet.safeParse({ ...set, levels: { unskilled: -1 } }).success);
		refused(MinimumWagesSet.safeParse({ ...set, levels: { skilled: 0.5 } }).success);
		refused(MinimumWagesSet.safeParse({ levels: set.levels }).success);
	});

	it('keeps up to 20 dated sets on a State, none on one saved before', () => {
		const state = { stateCode: '19', ptSlabs: [{ upToPaise: null, taxPaise: 200_00 }] };
		expect(StatePayrollRules.parse(state)).not.toHaveProperty('minimumWages');
		const set = { from: '2026-07-01', levels: { unskilled: 9_826_00 } };
		accepted(
			StatePayrollRules.safeParse({ ...state, minimumWages: Array.from({ length: 20 }, () => set) }).success,
		);
		refused(StatePayrollRules.safeParse({ ...state, minimumWages: Array.from({ length: 21 }, () => set) }).success);
	});
});

describe('a revision asked for (SR2)', () => {
	it('comes in by a % of the CTC, an amount a month, a new yearly CTC, or the heads typed', () => {
		const ways = [
			{ kind: 'percent', pct: 10 },
			{ kind: 'percent', pct: -90 },
			{ kind: 'percent', pct: 500 },
			{ kind: 'amount', monthINR: 1_500 },
			{ kind: 'amount', monthINR: -10_000_000 },
			{ kind: 'amount', monthINR: 10_000_000 },
			{ kind: 'ctc', yearINR: 4_20_000 },
			{ kind: 'ctc', yearINR: 1_000_000_000 },
		];
		for (const way of ways) expect(RevisionWay.parse(way)).toEqual(way);
		expect(RevisionWay.parse({ kind: 'heads', structure: { basic: 13_000 } })).toEqual({
			kind: 'heads',
			structure: { basic: 13_000, da: 0, hra: 0, special: 0, conveyance: 0, other: 0 },
		});
		for (const way of [
			{ kind: 'percent', pct: -90.5 },
			{ kind: 'percent', pct: 500.5 },
			{ kind: 'amount', monthINR: 10_000_001 },
			{ kind: 'amount', monthINR: -10_000_001 },
			{ kind: 'ctc', yearINR: 0 },
			{ kind: 'ctc', yearINR: 1_000_000_001 },
			{ kind: 'heads', structure: {} },
			{ kind: 'bonus', amount: 1 },
		])
			refused(RevisionWay.safeParse(way).success);
	});

	it('splits by the person’s own structure, with nothing typed over, the CTC locked and no agreement, unless said', () => {
		const ask = { way: { kind: 'percent', pct: 8 }, from: '2026-04-01', reason: ' Annual increment ' };
		expect(SalaryRevisionInput.parse(ask)).toEqual({
			...ask,
			reason: 'Annual increment',
			templateId: null,
			typed: {},
			lockCtc: true,
			agreed: false,
		});
		const typed = SalaryRevisionInput.parse({
			...ask,
			templateId: 'sst_shop',
			typed: { hra: 5_000 },
			lockCtc: false,
			agreed: true,
		});
		expect(typed).toMatchObject({ templateId: 'sst_shop', typed: { hra: 5_000 }, lockCtc: false, agreed: true });
	});

	it('keeps only the heads typed over, never reading an untouched head as typed at nothing', () => {
		const ask = { way: { kind: 'ctc', yearINR: 4_20_000 }, from: '2026-04-01', reason: 'Promotion' };
		expect(SalaryRevisionInput.parse({ ...ask, typed: {} }).typed).toEqual({});
		expect(SalaryRevisionInput.parse({ ...ask, typed: { hra: 6_000 } }).typed).toEqual({ hra: 6_000 });
		expect(SalaryRevisionInput.parse({ ...ask, typed: { basic: 15_000, other: 0 } }).typed).toEqual({
			basic: 15_000,
			other: 0,
		});
		refused(SalaryRevisionInput.safeParse({ ...ask, typed: { special: 100_000_001 } }).success);
	});

	it('needs a reason of 3 to 300 letters and a day it counts from', () => {
		const ask = { way: { kind: 'percent', pct: 8 }, from: '2026-04-01' };
		for (const reason of ['', 'ok', ' no ']) refused(SalaryRevisionInput.safeParse({ ...ask, reason }).success);
		accepted(SalaryRevisionInput.safeParse({ ...ask, reason: 'x'.repeat(300) }).success);
		refused(SalaryRevisionInput.safeParse({ ...ask, reason: 'x'.repeat(301) }).success);
		refused(SalaryRevisionInput.safeParse({ ...ask, reason: 'Increment', from: '2026-04' }).success);
		refused(SalaryRevisionInput.safeParse({ ...ask, reason: 'Increment', typed: { hra: -1 } }).success);
	});
});

describe('a revision’s breakup (SR2, SR4)', () => {
	const side = { structure, grossINR: 23_600, employerINR: 2_400, ctcMonthINR: 26_000, takeHomeINR: 21_150 };
	const preview = {
		now: side,
		next: { ...side, grossINR: 25_488, ctcMonthINR: 28_080 },
		lines: [{ head: 'basic', nowINR: 12_000, nextINR: 12_960, changeINR: 960 }],
		changePct: 8,
		decrease: false,
		arrears: { inr: 3_776, months: ['2026-04', '2026-05'], paidIn: '2026-06' },
		checks: [
			{ code: 'below_minimum_wage', blocking: true, inr: 450 },
			{ code: 'decrease_needs_agreement', blocking: true },
		],
	};

	it('shows now and next, each head’s change, the arrears and the checks, a check’s amount nothing unless said', () => {
		const parsed = SalaryRevisionPreview.parse(preview);
		expect(parsed.checks).toEqual([
			{ code: 'below_minimum_wage', blocking: true, inr: 450 },
			{ code: 'decrease_needs_agreement', blocking: true, inr: 0 },
		]);
		expect(parsed.arrears).toEqual(preview.arrears);
		expect(SalaryRevisionPreview.parse({ ...preview, arrears: null, checks: [] })).toMatchObject({
			arrears: null,
			checks: [],
		});
	});

	it('checks for a rest below nothing, pay under the minimum wage, a decrease without agreement and wages under half', () => {
		for (const code of ['rest_below_zero', 'below_minimum_wage', 'decrease_needs_agreement', 'wages_under_half'])
			accepted(SalaryRevisionPreview.safeParse({ ...preview, checks: [{ code, blocking: false }] }).success);
		refused(
			SalaryRevisionPreview.safeParse({ ...preview, checks: [{ code: 'over_budget', blocking: false }] }).success,
		);
		refused(
			SalaryRevisionPreview.safeParse({ ...preview, lines: [{ ...preview.lines[0], head: 'bonus' }] }).success,
		);
		refused(SalaryRevisionPreview.safeParse({ ...preview, arrears: undefined }).success);
		refused(SalaryRevisionPreview.safeParse({ ...preview, next: { ...side, takeHomeINR: undefined } }).success);
	});
});

describe('increments, many at once (brief 26 SR3)', () => {
	const message = (result: { error?: { issues: { message: string }[] } }) => result.error?.issues[0]?.message;
	const plan = {
		name: ' 2027 increments ',
		kind: 'rating',
		bands: [
			{ rating: 'A', pct: 12 },
			{ rating: 'B', pct: 8 },
		],
	};

	it('saves a plan by rating band, the same % or the same amount, the others nothing', () => {
		expect(IncrementPlanWrite.parse(plan)).toEqual({ ...plan, name: '2027 increments', pct: 0, amountMonthINR: 0 });
		expect(IncrementPlanWrite.parse({ name: 'Flat', kind: 'percent', pct: 7 })).toEqual({
			name: 'Flat',
			kind: 'percent',
			bands: [],
			pct: 7,
			amountMonthINR: 0,
		});
		expect(IncrementPlanWrite.parse({ name: 'Flat', kind: 'amount', amountMonthINR: -500 }).amountMonthINR).toBe(
			-500,
		);
		refused(IncrementPlanWrite.safeParse({ ...plan, kind: 'grade' }).success);
	});

	it('refuses a rating twice, more than ten bands, and %s or amounts beyond the limits', () => {
		expect(
			message(
				IncrementPlanWrite.safeParse({
					...plan,
					bands: [
						{ rating: 'A', pct: 12 },
						{ rating: 'A', pct: 8 },
					],
				}),
			),
		).toBe('increment_rating_twice');
		const band = (at: number) => ({ rating: `R${at}`, pct: 5 });
		accepted(
			IncrementPlanWrite.safeParse({ ...plan, bands: Array.from({ length: 10 }, (_, at) => band(at)) }).success,
		);
		refused(
			IncrementPlanWrite.safeParse({ ...plan, bands: Array.from({ length: 11 }, (_, at) => band(at)) }).success,
		);
		for (const pct of [-90.5, 500.5]) {
			refused(IncrementPlanWrite.safeParse({ ...plan, pct }).success);
			refused(IncrementPlanWrite.safeParse({ ...plan, bands: [{ rating: 'A', pct }] }).success);
		}
		for (const pct of [-90, 500]) accepted(IncrementPlanWrite.safeParse({ ...plan, pct }).success);
		refused(IncrementPlanWrite.safeParse({ ...plan, bands: [{ rating: '', pct: 5 }] }).success);
		refused(IncrementPlanWrite.safeParse({ ...plan, bands: [{ rating: 'x'.repeat(11), pct: 5 }] }).success);
		refused(IncrementPlanWrite.safeParse({ ...plan, amountMonthINR: 10_000_001 }).success);
		refused(IncrementPlanWrite.safeParse({ ...plan, name: 'X' }).success);
	});

	it('keeps a saved plan with its id and the time it was saved', () => {
		const saved = IncrementPlan.parse({ ...plan, id: 'ipl_1', updatedAt: '2026-11-26T05:00:00.000Z' });
		expect(saved).toMatchObject({ id: 'ipl_1', name: '2027 increments' });
		refused(IncrementPlan.safeParse({ ...plan, id: '', updatedAt: '2026-11-26T05:00:00.000Z' }).success);
	});

	it('takes 1 to 500 rows from one day for one reason, each a way in with its rating or none', () => {
		const rows = {
			from: '2027-04-01',
			reason: ' 2027 increments ',
			rows: [{ employeeId: 'emp_1', way: { kind: 'percent', pct: 12 } }],
		};
		expect(IncrementRowsInput.parse(rows)).toEqual({
			from: '2027-04-01',
			reason: '2027 increments',
			rows: [{ employeeId: 'emp_1', way: { kind: 'percent', pct: 12 }, rating: null }],
		});
		expect(IncrementRowsInput.parse({ ...rows, rows: [{ ...rows.rows[0], rating: ' A ' }] }).rows[0]?.rating).toBe(
			'A',
		);
		refused(IncrementRowsInput.safeParse({ ...rows, rows: [] }).success);
		const many = (n: number) =>
			Array.from({ length: n }, (_, at) => ({ employeeId: `emp_${at}`, way: { kind: 'percent', pct: 5 } }));
		accepted(IncrementRowsInput.safeParse({ ...rows, rows: many(500) }).success);
		refused(IncrementRowsInput.safeParse({ ...rows, rows: many(501) }).success);
		refused(IncrementRowsInput.safeParse({ ...rows, reason: 'ok' }).success);
		refused(
			IncrementRowsInput.safeParse({ ...rows, rows: [{ ...rows.rows[0], way: { kind: 'percent', pct: 600 } }] })
				.success,
		);
		refused(IncrementRowsInput.safeParse({ ...rows, rows: [{ ...rows.rows[0], rating: 'x'.repeat(11) }] }).success);
	});

	it('works each row out with its CTC now and new, the change and the checks, and says what Accept did with it', () => {
		const preview = {
			employeeId: 'emp_1',
			ctcYearNowINR: 3_60_000,
			ctcYearNewINR: 4_03_200,
			changeMonthINR: 3_600,
			changePct: 12,
			checks: [{ code: 'below_minimum_wage', blocking: true }],
		};
		expect(IncrementRowPreview.parse(preview).checks).toEqual([
			{ code: 'below_minimum_wage', blocking: true, inr: 0 },
		]);
		refused(IncrementRowPreview.safeParse({ ...preview, checks: [{ code: 'too_high', blocking: true }] }).success);
		expect(IncrementRowResult.parse({ employeeId: 'emp_1', ok: true, problem: null })).toEqual({
			employeeId: 'emp_1',
			ok: true,
			problem: null,
		});
		expect(IncrementRowResult.parse({ employeeId: 'emp_2', ok: false, problem: 'employee_changed' }).problem).toBe(
			'employee_changed',
		);
		refused(IncrementRowResult.safeParse({ employeeId: 'emp_2', ok: false }).success);
	});
});
