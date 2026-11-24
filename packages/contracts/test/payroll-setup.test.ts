import { describe, expect, it } from 'vitest';

import {
	AdvanceGive,
	AdvanceSchedule,
	PayrollAdvance,
	PayrollRow,
	PayrollRulesVersion,
	PayrollRulesWrite,
	PayrollRun,
	Payslip,
	SalaryHead,
	SalaryTemplate,
	SalaryTemplateEdit,
	SalaryTemplateWrite,
	SchemeLine,
	StatutoryFile,
	StatutoryFiling,
	StatutoryKind,
	StatutoryReturn,
	StructureComponentWrite,
	StructurePreview,
	StructurePreviewInput,
} from '../src/payroll';

/** Payroll set-up and after the run (accounts brief S1, S2, S4, S6, S7, S9): what the screens send and get. */

const accepted = (input: unknown) => expect(input).toBe(true);
const refused = (input: unknown) => expect(input).toBe(false);
const message = (result: { error?: { issues: { message: string }[] } }) => result.error?.issues[0]?.message;

const row = {
	employeeId: 'emp_1',
	name: 'Priya Sen',
	locationId: 'loc_kolkata',
	paidDays: 29,
	grossPaise: 1_740_000,
	pfWagesPaise: 870_000,
	pfEmployeePaise: 104_400,
	pfEmployerPaise: 104_400,
	epsPaise: 72_500,
	esiEmployeePaise: 13_100,
	esiEmployerPaise: 56_600,
	ptPaise: 13_000,
	tdsPaise: 0,
	advancePaise: 100_000,
	netPaise: 1_509_500,
};
const run = {
	id: 'pr_2611',
	month: '2026-11',
	status: 'posted',
	rows: [row],
	rulesFrom: '2026-04-01',
	createdAt: '2026-12-01T05:00:00.000Z',
	updatedAt: '2026-12-01T05:00:00.000Z',
	version: 2,
};

describe('a run’s rows and the run, before and after the welfare fund, gratuity and heads', () => {
	it('still reads an old run without them', () => {
		const parsed = PayrollRun.parse(run);
		expect(parsed.rows[0]).not.toHaveProperty('headsPaise');
		expect(parsed).not.toHaveProperty('schemesFrom');
		expect(parsed).not.toHaveProperty('paidOn');
	});

	it('keeps the welfare fund, gratuity and each head paid, and the run’s scheme version, PF charges and payday', () => {
		const full = {
			...row,
			lwfEmployeePaise: 300,
			lwfEmployerPaise: 1_500,
			gratuityPaise: 76_900,
			headsPaise: { basic: 696_000, da: 87_000, hra: 348_000, conveyance: 154_667, special: 454_333, other: 0 },
		};
		expect(PayrollRow.parse(full)).toEqual(full);
		refused(PayrollRow.safeParse({ ...full, headsPaise: { basic: 0.5 } }).success);
		refused(PayrollRow.safeParse({ ...full, gratuityPaise: 0.5 }).success);
		const paid = {
			...run,
			rows: [full],
			schemesFrom: '2026-04-01',
			pfAdminPaise: 50_000,
			edliPaise: 11_900,
			paidOn: '2026-12-01',
		};
		expect(PayrollRun.parse(paid)).toMatchObject({
			schemesFrom: '2026-04-01',
			pfAdminPaise: 50_000,
			edliPaise: 11_900,
			paidOn: '2026-12-01',
		});
		expect(PayrollRun.parse({ ...run, paidOn: null }).paidOn).toBeNull();
		refused(PayrollRun.safeParse({ ...run, schemesFrom: '2026-04' }).success);
		refused(PayrollRun.safeParse({ ...run, edliPaise: 1.5 }).success);
	});
});

/** The rules in force from April 2026, as S1 shows them. */
const rules = {
	from: '2026-04-01',
	pfRatePct: 12,
	pfWageCapPaise: 1_500_000,
	epsRatePct: 8.33,
	epsCapPaise: 125_000,
	esiEmployeePct: 0.75,
	esiEmployerPct: 3.25,
	esiGrossLimitPaise: 2_100_000,
	ptSlabs: [
		{ upToPaise: 1_000_000, taxPaise: 0 },
		{ upToPaise: 1_500_000, taxPaise: 11_000 },
		{ upToPaise: 2_500_000, taxPaise: 13_000 },
		{ upToPaise: 4_000_000, taxPaise: 15_000 },
		{ upToPaise: null, taxPaise: 20_000 },
	],
	maxDeductionPct: 50,
	pfAdminPct: 0.5,
	pfAdminMinPaise: 50_000,
	edliPct: 0.5,
	pfHeadcount: 20,
	esiHeadcount: 10,
	bonusHeadcount: 20,
	bonusWarnAt: 18,
	gratuityHeadcount: 10,
	gratuityDaysPerYear: 15,
	gratuityMonthDays: 26,
	lwfEmployeePaise: 300,
	lwfEmployerPaise: 1_500,
	lwfMonths: [6, 12],
	pfDueDay: 15,
	esiDueDay: 15,
	ptDueDay: 21,
	lwfDueDay: 15,
};

describe('a version of the payroll rules', () => {
	it('takes every rule, with no note unless written', () => {
		expect(PayrollRulesWrite.parse(rules)).toEqual({ ...rules, note: '' });
		expect(PayrollRulesWrite.parse({ ...rules, note: ' Notification 12/2026 ' }).note).toBe('Notification 12/2026');
		refused(PayrollRulesWrite.safeParse({ ...rules, note: 'x'.repeat(301) }).success);
	});

	it('needs professional tax to end with a slab open above, of 1 to 20 slabs', () => {
		const closed = rules.ptSlabs.slice(0, 4);
		expect(message(PayrollRulesWrite.safeParse({ ...rules, ptSlabs: closed }))).toBe('pt_last_slab_open');
		accepted(PayrollRulesWrite.safeParse({ ...rules, ptSlabs: [{ upToPaise: null, taxPaise: 0 }] }).success);
		refused(PayrollRulesWrite.safeParse({ ...rules, ptSlabs: [] }).success);
		const twenty = [
			...Array.from({ length: 19 }, (_, at) => ({ upToPaise: (at + 1) * 100_000, taxPaise: 0 })),
			{ upToPaise: null, taxPaise: 20_000 },
		];
		accepted(PayrollRulesWrite.safeParse({ ...rules, ptSlabs: twenty }).success);
		refused(PayrollRulesWrite.safeParse({ ...rules, ptSlabs: [{ upToPaise: 1, taxPaise: 0 }, ...twenty] }).success);
		refused(PayrollRulesWrite.safeParse({ ...rules, ptSlabs: [{ upToPaise: null, taxPaise: -1 }] }).success);
	});

	it('keeps every percent from 0 to 100', () => {
		for (const key of [
			'pfRatePct',
			'epsRatePct',
			'esiEmployeePct',
			'esiEmployerPct',
			'maxDeductionPct',
			'pfAdminPct',
			'edliPct',
		]) {
			accepted(PayrollRulesWrite.safeParse({ ...rules, [key]: 0 }).success);
			accepted(PayrollRulesWrite.safeParse({ ...rules, [key]: 100 }).success);
			refused(PayrollRulesWrite.safeParse({ ...rules, [key]: 100.01 }).success);
			refused(PayrollRulesWrite.safeParse({ ...rules, [key]: -0.01 }).success);
		}
	});

	it('keeps amounts in whole paise, headcounts above nothing, and each due day from the 1st to the 31st', () => {
		for (const key of [
			'pfWageCapPaise',
			'epsCapPaise',
			'esiGrossLimitPaise',
			'pfAdminMinPaise',
			'lwfEmployeePaise',
			'lwfEmployerPaise',
		]) {
			refused(PayrollRulesWrite.safeParse({ ...rules, [key]: -1 }).success);
			refused(PayrollRulesWrite.safeParse({ ...rules, [key]: 0.5 }).success);
		}
		for (const key of ['pfHeadcount', 'esiHeadcount', 'bonusHeadcount', 'bonusWarnAt', 'gratuityHeadcount'])
			refused(PayrollRulesWrite.safeParse({ ...rules, [key]: 0 }).success);
		for (const key of ['pfDueDay', 'esiDueDay', 'ptDueDay', 'lwfDueDay']) {
			accepted(PayrollRulesWrite.safeParse({ ...rules, [key]: 1 }).success);
			accepted(PayrollRulesWrite.safeParse({ ...rules, [key]: 31 }).success);
			refused(PayrollRulesWrite.safeParse({ ...rules, [key]: 0 }).success);
			refused(PayrollRulesWrite.safeParse({ ...rules, [key]: 32 }).success);
		}
	});

	it('counts a gratuity month as 20 to 31 days, up to 60 days a year, and welfare-fund months 1 to 12', () => {
		accepted(PayrollRulesWrite.safeParse({ ...rules, gratuityMonthDays: 20 }).success);
		accepted(PayrollRulesWrite.safeParse({ ...rules, gratuityMonthDays: 31 }).success);
		refused(PayrollRulesWrite.safeParse({ ...rules, gratuityMonthDays: 19 }).success);
		refused(PayrollRulesWrite.safeParse({ ...rules, gratuityMonthDays: 32 }).success);
		accepted(PayrollRulesWrite.safeParse({ ...rules, gratuityDaysPerYear: 60 }).success);
		refused(PayrollRulesWrite.safeParse({ ...rules, gratuityDaysPerYear: 61 }).success);
		refused(PayrollRulesWrite.safeParse({ ...rules, gratuityDaysPerYear: 0 }).success);
		accepted(PayrollRulesWrite.safeParse({ ...rules, lwfMonths: [] }).success);
		refused(PayrollRulesWrite.safeParse({ ...rules, lwfMonths: [13] }).success);
		refused(PayrollRulesWrite.safeParse({ ...rules, lwfMonths: Array.from({ length: 13 }, () => 6) }).success);
		refused(PayrollRulesWrite.safeParse({ ...rules, from: '2026-04' }).success);
	});

	it('keeps a version added by a person, or the built-in one', () => {
		const version = { ...rules, id: 'prv_1', createdAt: '2026-04-01T00:00:00.000Z' };
		expect(PayrollRulesVersion.parse(version)).toEqual({ ...version, note: '', builtIn: false, createdBy: null });
		expect(PayrollRulesVersion.parse({ ...version, builtIn: true, createdBy: 'adm_1' })).toMatchObject({
			builtIn: true,
			createdBy: 'adm_1',
		});
		refused(PayrollRulesVersion.safeParse({ ...version, id: '' }).success);
	});
});

const s4 = [
	{ head: 'basic', how: 'percent', value: 40 },
	{ head: 'da', how: 'percent', value: 5 },
	{ head: 'hra', how: 'percent', value: 20 },
	{ head: 'conveyance', how: 'fixed', value: 1_600 },
	{ head: 'special', how: 'rest' },
];

describe('salary structure templates', () => {
	it('names six heads, and takes a component as a percent, a fixed amount or the rest', () => {
		expect(SalaryHead.options).toEqual(['basic', 'da', 'hra', 'conveyance', 'special', 'other']);
		expect(StructureComponentWrite.parse({ head: 'special', how: 'rest' })).toEqual({
			head: 'special',
			how: 'rest',
			value: 0,
		});
		refused(StructureComponentWrite.safeParse({ head: 'bonus', how: 'percent', value: 10 }).success);
		refused(StructureComponentWrite.safeParse({ head: 'basic', how: 'share', value: 10 }).success);
		refused(StructureComponentWrite.safeParse({ head: 'basic', how: 'fixed', value: -1 }).success);
		refused(StructureComponentWrite.safeParse({ head: 'basic', how: 'fixed', value: 100_000_001 }).success);
	});

	it('takes the S4 template with an example pay of ₹20,000 unless given', () => {
		const template = SalaryTemplateWrite.parse({ name: ' Shop staff ', components: s4 });
		expect(template).toMatchObject({ name: 'Shop staff', examplePayINR: 20_000 });
		expect(template.components[4]).toEqual({ head: 'special', how: 'rest', value: 0 });
		expect(
			SalaryTemplateWrite.parse({ name: 'Shop staff', components: s4, examplePayINR: 35_000 }).examplePayINR,
		).toBe(35_000);
	});

	it('refuses a head twice, two “rest” lines, and percents over 100 in all', () => {
		expect(
			message(
				SalaryTemplateWrite.safeParse({
					name: 'Twice',
					components: [...s4.slice(0, 2), { head: 'basic', how: 'fixed', value: 1 }],
				}),
			),
		).toBe('structure_head_twice');
		expect(
			message(
				SalaryTemplateWrite.safeParse({
					name: 'Two rests',
					components: [
						{ head: 'basic', how: 'percent', value: 50 },
						{ head: 'special', how: 'rest' },
						{ head: 'other', how: 'rest' },
					],
				}),
			),
		).toBe('structure_rest_twice');
		expect(
			message(
				SalaryTemplateWrite.safeParse({
					name: 'Too much',
					components: [
						{ head: 'basic', how: 'percent', value: 60 },
						{ head: 'hra', how: 'percent', value: 40.5 },
					],
				}),
			),
		).toBe('structure_over_100');
		accepted(
			SalaryTemplateWrite.safeParse({
				name: 'All of it',
				components: [
					{ head: 'basic', how: 'percent', value: 60 },
					{ head: 'hra', how: 'percent', value: 40 },
				],
			}).success,
		);
	});

	it('takes 1 to 6 components and a name of 2 to 80 letters', () => {
		refused(SalaryTemplateWrite.safeParse({ name: 'Empty', components: [] }).success);
		const six = ['basic', 'da', 'hra', 'conveyance', 'special', 'other'].map((head) => ({
			head,
			how: 'fixed',
			value: 1,
		}));
		accepted(SalaryTemplateWrite.safeParse({ name: 'Six', components: six }).success);
		refused(
			SalaryTemplateWrite.safeParse({
				name: 'Seven',
				components: [...six, { head: 'basic', how: 'fixed', value: 1 }],
			}).success,
		);
		refused(SalaryTemplateWrite.safeParse({ name: ' T ', components: s4 }).success);
		refused(SalaryTemplateWrite.safeParse({ name: 'x'.repeat(81), components: s4 }).success);
	});

	it('keeps a saved template at its version, and edits one at its version', () => {
		const saved = {
			...SalaryTemplateWrite.parse({ name: 'Shop staff', components: s4 }),
			id: 'st_1',
			createdAt: '2026-11-24T10:00:00.000Z',
			updatedAt: '2026-11-24T10:00:00.000Z',
			version: 0,
		};
		expect(SalaryTemplate.parse(saved)).toEqual(saved);
		expect(SalaryTemplateEdit.parse({ name: 'Shop staff', components: s4, version: 1 }).version).toBe(1);
		refused(SalaryTemplateEdit.safeParse({ name: 'Shop staff', components: s4 }).success);
	});

	it('previews a template on a pay: each head with how it counts as wages, the basic share and the shortfall', () => {
		expect(StructurePreviewInput.parse({ components: s4, payINR: 20_000 }).payINR).toBe(20_000);
		refused(StructurePreviewInput.safeParse({ components: [], payINR: 20_000 }).success);
		refused(StructurePreviewInput.safeParse({ components: s4, payINR: -1 }).success);
		const preview = {
			structure: { basic: 8_000, da: 1_000, hra: 4_000, conveyance: 1_600, special: 5_400, other: 0 },
			lines: [
				{ head: 'basic', inr: 8_000, treatment: 'yes' },
				{ head: 'hra', inr: 4_000, treatment: 'excluded' },
				{ head: 'special', inr: 5_400, treatment: 'over_half' },
			],
			totalINR: 20_000,
			basicSharePct: 45,
			shortfallINR: 1_000,
		};
		expect(StructurePreview.parse(preview)).toEqual(preview);
		refused(
			StructurePreview.safeParse({ ...preview, lines: [{ head: 'basic', inr: 1, treatment: 'maybe' }] }).success,
		);
		refused(StructurePreview.safeParse({ ...preview, structure: { basic: 8_000 } }).success);
	});
});

describe('schemes and payslips', () => {
	it('shows a scheme’s start, headcount, who is eligible and where it stands', () => {
		const line = { scheme: 'esi', startsAt: 10, headcount: 14, eligible: 6, status: 'applies' };
		expect(SchemeLine.parse(line)).toEqual(line);
		accepted(SchemeLine.safeParse({ ...line, scheme: 'pt', startsAt: null, eligible: null }).success);
		refused(SchemeLine.safeParse({ ...line, scheme: 'insurance' }).success);
		refused(SchemeLine.safeParse({ ...line, status: 'maybe' }).success);
	});

	it('gives a payslip with its earnings and deductions, the PF wages and the advance’s recovery where they apply', () => {
		const payslip = {
			month: '2026-11',
			company: 'K.R. Marketing',
			employeeId: 'emp_1',
			name: 'Priya Sen',
			code: 'E-0007',
			location: 'Kolkata',
			uan: '101234567890',
			daysInMonth: 30,
			paidDays: 29,
			earnings: [{ head: 'basic', paise: 696_000 }],
			grossPaise: 1_740_000,
			deductions: [
				{ key: 'pf', paise: 104_400, wagesPaise: 870_000 },
				{ key: 'advance', paise: 100_000, recovery: { n: 2, of: 5 } },
				{ key: 'pt', paise: 13_000 },
			],
			totalDeductionsPaise: 230_500,
			netPaise: 1_509_500,
			netWords: 'Fifteen thousand ninety-five rupees only',
			paidTo: { bank: 'HDFC Bank', last4: '4821' },
			paidOn: '2026-12-01',
			rulesFrom: '2026-04-01',
			schemesFrom: '2026-04-01',
			status: 'paid',
		};
		const parsed = Payslip.parse(payslip);
		expect(parsed.deductions).toEqual([
			{ key: 'pf', paise: 104_400, wagesPaise: 870_000, recovery: null },
			{ key: 'advance', paise: 100_000, wagesPaise: null, recovery: { n: 2, of: 5 } },
			{ key: 'pt', paise: 13_000, wagesPaise: null, recovery: null },
		]);
		accepted(
			Payslip.safeParse({ ...payslip, paidTo: null, paidOn: null, schemesFrom: null, status: 'draft' }).success,
		);
		refused(Payslip.safeParse({ ...payslip, deductions: [{ key: 'bonus', paise: 1 }] }).success);
		refused(Payslip.safeParse({ ...payslip, earnings: [{ head: 'tips', paise: 1 }] }).success);
		refused(Payslip.safeParse({ ...payslip, daysInMonth: 30.5 }).success);
	});
});

describe('statutory returns and files', () => {
	it('lists each return for its period, when it is due, how much and whether it is filed', () => {
		expect(StatutoryKind.options).toEqual(['pf', 'esi', 'pt', 'lwf', 'tds']);
		const tds = {
			kind: 'tds',
			period: '2026-10',
			periodTo: '2026-12',
			due: '2027-01-31',
			amountPaise: 1_200_000,
			status: 'later',
			filedOn: null,
			reference: '',
		};
		expect(StatutoryReturn.parse(tds)).toEqual(tds);
		accepted(
			StatutoryReturn.safeParse({ ...tds, status: 'filed', filedOn: '2027-01-20', reference: 'TOKEN123' })
				.success,
		);
		refused(StatutoryReturn.safeParse({ ...tds, status: 'late' }).success);
		refused(StatutoryReturn.safeParse({ ...tds, kind: 'gst' }).success);
	});

	it('records a filing with its day and a reference of 1 to 60 letters, trimmed', () => {
		expect(StatutoryFiling.parse({ filedOn: '2026-12-14', reference: ' TRRN 1234567890 ' })).toEqual({
			filedOn: '2026-12-14',
			reference: 'TRRN 1234567890',
		});
		refused(StatutoryFiling.safeParse({ filedOn: '2026-12-14', reference: '   ' }).success);
		refused(StatutoryFiling.safeParse({ filedOn: '2026-12-14', reference: 'x'.repeat(61) }).success);
		refused(StatutoryFiling.safeParse({ filedOn: '14-12-2026', reference: 'TRRN' }).success);
	});

	it('gives a portal file as its name and text', () => {
		const file = { fileName: 'ECR-2026-11.txt', text: '101234567890#~#PRIYA SEN' };
		expect(StatutoryFile.parse(file)).toEqual(file);
		refused(StatutoryFile.safeParse({ fileName: 'x' }).success);
	});
});

describe('advances', () => {
	const give = { amountINR: 5_000, givenOn: '2026-09-05', ledgerId: 'led_cash', perMonthINR: 1_000, version: 3 };

	it('gives an advance above nothing from a ledger, recovered a set amount a month, with no note unless written', () => {
		expect(AdvanceGive.parse(give)).toEqual({ ...give, note: '' });
		expect(AdvanceGive.parse({ ...give, note: ' Festival ' }).note).toBe('Festival');
		accepted(AdvanceGive.safeParse({ ...give, perMonthINR: 0 }).success);
		refused(AdvanceGive.safeParse({ ...give, amountINR: 0 }).success);
		refused(AdvanceGive.safeParse({ ...give, amountINR: 10_000_001 }).success);
		refused(AdvanceGive.safeParse({ ...give, perMonthINR: -1 }).success);
		refused(AdvanceGive.safeParse({ ...give, note: 'x'.repeat(201) }).success);
		refused(AdvanceGive.safeParse({ ...give, ledgerId: '' }).success);
	});

	it('keeps an advance given, and the schedule of what was and will be recovered', () => {
		const advance = {
			id: 'adv_1',
			employeeId: 'emp_1',
			givenOn: '2026-09-05',
			amountPaise: 500_000,
			ledgerId: 'led_cash',
			voucherId: 'vch_adv_1',
			note: '',
			createdBy: 'adm_1',
			createdAt: '2026-09-05T05:00:00.000Z',
		};
		expect(PayrollAdvance.parse(advance)).toEqual(advance);
		refused(PayrollAdvance.safeParse({ ...advance, amountPaise: 0 }).success);
		const schedule = {
			employeeId: 'emp_1',
			name: 'Priya Sen',
			perMonthPaise: 100_000,
			leftPaise: 300_000,
			given: [advance],
			rows: [
				{ month: '2026-09', givenPaise: 500_000, recoveredPaise: 0, leftPaise: 500_000, how: 'none' },
				{ month: '2026-10', givenPaise: 0, recoveredPaise: 100_000, leftPaise: 400_000, how: 'payroll' },
				{ month: '2026-12', givenPaise: 0, recoveredPaise: 100_000, leftPaise: 200_000, how: 'planned' },
			],
		};
		expect(AdvanceSchedule.parse(schedule)).toEqual(schedule);
		refused(AdvanceSchedule.safeParse({ ...schedule, rows: [{ ...schedule.rows[0], how: 'cash' }] }).success);
	});
});
