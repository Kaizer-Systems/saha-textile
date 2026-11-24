import { describe, expect, it } from 'vitest';

import { type SalaryStructure, structureTotal } from '../src/payroll/payroll-rules';
import {
	PAYROLL_SCHEMES_2026,
	SALARY_HEADS,
	advanceSchedule,
	csvText,
	ecrFile,
	esicFile,
	gratuityProvision,
	labourWelfare,
	payslipHeads,
	pfEstablishmentCharges,
	schemeLines,
	statutoryDue,
	structureFromTemplate,
	tdsQuarter,
	wageShortfall,
	wageTreatment,
} from '../src/payroll/payroll-statutory';

/**
 * Payroll beyond a month's pay (accounts brief S1, S2, S4, S6, S7, S9), checked against the law: EPF from 20 people
 * (voluntary below), ESI and gratuity from 10, bonus from 20; EPF administration at 0.5% with a ₹500 monthly minimum
 * and EDLI at 0.5%; West Bengal's labour welfare fund of ₹3 and ₹15 in June and December; gratuity at 15/26 of a
 * month's wages a year; PF and ESI due on the 15th, West Bengal PT on the 21st, the TDS statement (24Q) by the end of
 * the month after each quarter (31 May for the last); and the ECR 2.0 and ESIC upload layouts.
 */

const S = PAYROLL_SCHEMES_2026;
const rs = (rupees: number) => Math.round(rupees * 100);
const pay = (over: Partial<SalaryStructure> = {}): SalaryStructure => ({
	basic: 0,
	da: 0,
	hra: 0,
	special: 0,
	conveyance: 0,
	other: 0,
	...over,
});

describe('the scheme rules in force from April 2026', () => {
	it('hold the headcounts, charges, welfare fund and due days', () => {
		expect(SALARY_HEADS).toEqual(['basic', 'da', 'hra', 'conveyance', 'special', 'other']);
		expect(S).toEqual({
			from: '2026-04-01',
			pfAdminPct: 0.5,
			pfAdminMinPaise: rs(500),
			edliPct: 0.5,
			pfHeadcount: 20,
			esiHeadcount: 10,
			bonusHeadcount: 20,
			bonusWarnAt: 18,
			gratuityHeadcount: 10,
			gratuityDaysPerYear: 15,
			gratuityMonthDays: 26,
			lwfEmployeePaise: rs(3),
			lwfEmployerPaise: rs(15),
			lwfMonths: [6, 12],
			pfDueDay: 15,
			esiDueDay: 15,
			ptDueDay: 21,
			lwfDueDay: 15,
		});
	});
});

describe('which schemes apply', () => {
	const status = (headcount: number, pfOnAny = true) =>
		Object.fromEntries(schemeLines({ headcount, esiEligible: 6, pfOnAny }, S).map((l) => [l.scheme, l.status]));

	it('shows the S2 picture for 14 people: PF voluntary, ESI, gratuity, PT and LWF apply, bonus not yet', () => {
		expect(schemeLines({ headcount: 14, esiEligible: 6, pfOnAny: true }, S)).toEqual([
			{ scheme: 'pf', startsAt: 20, headcount: 14, eligible: null, status: 'voluntary' },
			{ scheme: 'esi', startsAt: 10, headcount: 14, eligible: 6, status: 'applies' },
			{ scheme: 'bonus', startsAt: 20, headcount: 14, eligible: null, status: 'not_yet' },
			{ scheme: 'gratuity', startsAt: 10, headcount: 14, eligible: null, status: 'applies' },
			{ scheme: 'pt', startsAt: null, headcount: 14, eligible: null, status: 'applies' },
			{ scheme: 'lwf', startsAt: null, headcount: 14, eligible: null, status: 'applies' },
		]);
	});

	it('brings in PF and bonus at 20, warns of bonus at 18 and 19', () => {
		expect(status(20)).toMatchObject({ pf: 'applies', bonus: 'applies' });
		expect(status(25, false)).toMatchObject({ pf: 'applies' });
		expect(status(18)).toMatchObject({ bonus: 'soon' });
		expect(status(19)).toMatchObject({ bonus: 'soon' });
		expect(status(17)).toMatchObject({ bonus: 'not_yet' });
	});

	it('keeps PF off below 20 when nobody joined it, and ESI and gratuity off below 10', () => {
		expect(status(14, false)).toMatchObject({ pf: 'not_yet' });
		expect(status(9)).toMatchObject({ esi: 'not_yet', gratuity: 'not_yet' });
		expect(status(10)).toMatchObject({ esi: 'applies', gratuity: 'applies' });
	});

	it('needs someone salaried for professional tax and the welfare fund', () => {
		expect(status(0, false)).toEqual({
			pf: 'not_yet',
			esi: 'not_yet',
			bonus: 'not_yet',
			gratuity: 'not_yet',
			pt: 'not_yet',
			lwf: 'not_yet',
		});
	});
});

describe('the employer’s PF charges, the welfare fund and gratuity', () => {
	it('charges EPF administration at 0.5% with a ₹500 minimum, and EDLI at 0.5%', () => {
		// ₹87 + ₹15,000 of capped wages: 0.5% is ₹118.50, so the minimum applies; EDLI rounds to ₹119.
		expect(pfEstablishmentCharges([rs(8_700), rs(15_000)], S)).toEqual({ adminPaise: rs(500), edliPaise: rs(119) });
		// Two hundred members at the cap: 0.5% of ₹30 lakh.
		expect(
			pfEstablishmentCharges(
				Array.from({ length: 200 }, () => rs(15_000)),
				S,
			),
		).toEqual({
			adminPaise: rs(15_000),
			edliPaise: rs(15_000),
		});
	});

	it('charges nothing for a month with no PF wages', () => {
		expect(pfEstablishmentCharges([], S)).toEqual({ adminPaise: 0, edliPaise: 0 });
		expect(pfEstablishmentCharges([0, 0], S)).toEqual({ adminPaise: 0, edliPaise: 0 });
	});

	it('takes the welfare fund in June and December from someone paid that month', () => {
		expect(labourWelfare('2026-06', rs(17_400), S)).toEqual({ employeePaise: rs(3), employerPaise: rs(15) });
		expect(labourWelfare('2026-12', 1, S)).toEqual({ employeePaise: rs(3), employerPaise: rs(15) });
		expect(labourWelfare('2026-07', rs(17_400), S)).toEqual({ employeePaise: 0, employerPaise: 0 });
		expect(labourWelfare('2026-06', 0, S)).toEqual({ employeePaise: 0, employerPaise: 0 });
	});

	it('provides 15/26 of a month’s wages a year for gratuity, a twelfth a month, and nothing where it doesn’t apply', () => {
		// Wages ₹16,000 (basic, or half the pay): 16,000 × 15 ÷ 26 ÷ 12 = ₹769.23.
		expect(gratuityProvision(pay({ basic: rs(16_000), special: rs(16_000) }), true, S)).toBe(rs(769));
		// Basic under half of ₹40,000: wages count as ₹20,000.
		expect(gratuityProvision(pay({ basic: rs(10_000), special: rs(30_000) }), true, S)).toBe(rs(962));
		expect(gratuityProvision(pay({ basic: rs(16_000), special: rs(16_000) }), false, S)).toBe(0);
	});
});

describe('salary structure templates', () => {
	const s4 = [
		{ head: 'basic', how: 'percent', value: 40 },
		{ head: 'da', how: 'percent', value: 5 },
		{ head: 'hra', how: 'percent', value: 20 },
		{ head: 'conveyance', how: 'fixed', value: rs(1_600) },
		{ head: 'special', how: 'rest', value: 0 },
	] as const;

	it('builds the S4 structure for ₹20,000 a month, the special allowance taking the rest', () => {
		const structure = structureFromTemplate(s4, rs(20_000));
		expect(structure).toEqual(
			pay({ basic: rs(8_000), da: rs(1_000), hra: rs(4_000), conveyance: rs(1_600), special: rs(5_400) }),
		);
		expect(structureTotal(structure)).toBe(rs(20_000));
		// Basic and DA ₹9,000 are under half: ₹1,000 of the allowances counts as wages.
		expect(wageShortfall(structure)).toBe(rs(1_000));
	});

	it('adds a fixed amount to a head a percent already set, and rounds a percent to the rupee', () => {
		expect(
			structureFromTemplate(
				[
					{ head: 'basic', how: 'percent', value: 40 },
					{ head: 'basic', how: 'fixed', value: rs(500) },
				],
				rs(20_001),
			),
		).toEqual(pay({ basic: rs(8_500) }));
	});

	it('leaves what no head takes when there is no “rest”, and gives the rest nothing when the others take it all', () => {
		expect(structureFromTemplate([{ head: 'basic', how: 'percent', value: 50 }], rs(20_000))).toEqual(
			pay({ basic: rs(10_000) }),
		);
		expect(
			structureFromTemplate(
				[
					{ head: 'basic', how: 'percent', value: 80 },
					{ head: 'hra', how: 'percent', value: 30 },
					{ head: 'other', how: 'rest', value: 0 },
				],
				rs(20_000),
			),
		).toEqual(pay({ basic: rs(16_000), hra: rs(6_000) }));
	});

	it('counts basic and DA as wages, never HRA, and the rest only above the half line', () => {
		expect(SALARY_HEADS.map((head) => [head, wageTreatment(head)])).toEqual([
			['basic', 'yes'],
			['da', 'yes'],
			['hra', 'excluded'],
			['conveyance', 'over_half'],
			['special', 'over_half'],
			['other', 'over_half'],
		]);
		expect(wageShortfall(pay({ basic: rs(16_000), special: rs(16_000) }))).toBe(0);
	});
});

describe('payslip lines', () => {
	it('pays each head for 29 of 30 days to the paisa, adding up to the gross: Priya Sen’s S6 payslip', () => {
		const priya = pay({
			basic: rs(7_200),
			da: rs(900),
			hra: rs(3_600),
			conveyance: rs(1_600),
			special: rs(4_700),
		});
		expect(payslipHeads(priya, 30, 29, rs(17_400))).toEqual({
			basic: rs(6_960),
			da: rs(870),
			hra: rs(3_480),
			conveyance: rs(1_546.67),
			special: rs(4_543.33),
			other: 0,
		});
	});

	it('puts the paise the rupee-rounded gross leaves on the last head paid', () => {
		// ₹10,000 for 30 of 31 days: gross ₹9,677 to the rupee, the heads ₹9,677.41 to the paisa.
		const heads = payslipHeads(pay({ basic: rs(5_000), hra: rs(2_500), special: rs(2_500) }), 31, 30, rs(9_677));
		expect(heads).toEqual({ basic: 483_871, da: 0, hra: 241_935, conveyance: 0, special: 241_894, other: 0 });
		expect(Object.values(heads).reduce((s, v) => s + v, 0)).toBe(rs(9_677));
	});

	it('pays no more than the month for more days than it has, and nothing in a month of no days', () => {
		expect(payslipHeads(pay({ basic: rs(8_000), special: rs(8_000) }), 30, 35, rs(16_000))).toMatchObject({
			basic: rs(8_000),
			special: rs(8_000),
		});
		expect(payslipHeads(pay({ basic: rs(8_000) }), 0, 20, 0)).toEqual(pay());
	});

	it('has no head to put a difference on when nothing is paid', () => {
		expect(payslipHeads(pay(), 30, 30, rs(5))).toEqual(pay());
	});
});

describe('when payments and returns fall due', () => {
	it('falls due on the 15th for PF, ESI and the welfare fund, and the 21st for West Bengal PT', () => {
		expect(statutoryDue('pf', '2026-11', S)).toBe('2026-12-15');
		expect(statutoryDue('esi', '2026-11', S)).toBe('2026-12-15');
		expect(statutoryDue('pt', '2026-12', S)).toBe('2027-01-21');
		expect(statutoryDue('lwf', '2026-06', S)).toBe('2026-07-15');
		expect(statutoryDue('lwf', '2026-12', S)).toBe('2027-01-15');
	});

	it('keeps a due day inside a short month', () => {
		expect(statutoryDue('pt', '2027-01', { ...S, ptDueDay: 31 })).toBe('2027-02-28');
	});

	it('files the TDS statement by the end of the month after each quarter, the last by 31 May', () => {
		expect(tdsQuarter('2026-04')).toEqual({ from: '2026-04', to: '2026-06', due: '2026-07-31' });
		expect(tdsQuarter('2026-06')).toEqual({ from: '2026-04', to: '2026-06', due: '2026-07-31' });
		expect(tdsQuarter('2026-07')).toEqual({ from: '2026-07', to: '2026-09', due: '2026-10-31' });
		expect(tdsQuarter('2026-09')).toEqual({ from: '2026-07', to: '2026-09', due: '2026-10-31' });
		expect(tdsQuarter('2026-10')).toEqual({ from: '2026-10', to: '2026-12', due: '2027-01-31' });
		expect(tdsQuarter('2026-12')).toEqual({ from: '2026-10', to: '2026-12', due: '2027-01-31' });
		expect(tdsQuarter('2027-01')).toEqual({ from: '2027-01', to: '2027-03', due: '2027-05-31' });
		expect(tdsQuarter('2027-03')).toEqual({ from: '2027-01', to: '2027-03', due: '2027-05-31' });
		expect(statutoryDue('tds', '2026-11', S)).toBe('2027-01-31');
	});
});

describe('the portal files', () => {
	const priya = {
		uan: '101234567890',
		name: 'Priya Sen',
		grossPaise: rs(17_400),
		epfWagesPaise: rs(8_700),
		epsWagesPaise: rs(8_700),
		edliWagesPaise: rs(8_700),
		employeePaise: rs(1_044),
		epsPaise: rs(725),
		employerDiffPaise: rs(319),
		ncpDays: 1,
		refundPaise: 0,
	};

	it('writes the ECR 2.0 line: eleven fields joined by #~#, the name in capitals, rupees whole', () => {
		expect(ecrFile([priya])).toBe(
			'101234567890#~#PRIYA SEN#~#17400#~#8700#~#8700#~#8700#~#1044#~#725#~#319#~#1#~#0',
		);
	});

	it('puts each member on a line of their own, and writes nothing for nobody', () => {
		const rahul = { ...priya, uan: '101234567891', name: 'Rahul Das', grossPaise: rs(16_000.4), ncpDays: 0 };
		expect(ecrFile([priya, rahul]).split('\n')).toEqual([
			'101234567890#~#PRIYA SEN#~#17400#~#8700#~#8700#~#8700#~#1044#~#725#~#319#~#1#~#0',
			'101234567891#~#RAHUL DAS#~#16000#~#8700#~#8700#~#8700#~#1044#~#725#~#319#~#0#~#0',
		]);
		expect(ecrFile([])).toBe('');
	});

	it('writes the ESIC upload with its header, the reason and last day for someone who left', () => {
		const file = esicFile([
			{ ipNumber: '1234567890', name: 'Priya, Sen', paidDays: 29, grossPaise: rs(17_400), leftOn: '2026-11-20' },
			{ ipNumber: '1234567891', name: 'Rahul Das', paidDays: 30, grossPaise: rs(16_000), leftOn: null },
		]);
		expect(file.split('\n')).toEqual([
			'IP Number,IP Name,No of Days for which wages paid/payable during the month,Total Monthly Wages,Reason Code for Zero workings days,Last Working Day',
			'1234567890,"Priya, Sen",29,17400,2,20/11/2026',
			'1234567891,Rahul Das,30,16000,0,',
		]);
	});

	it('quotes a cell with a comma, a quote or a new line, doubling its quotes', () => {
		expect(
			csvText(
				['a', 'b'],
				[
					['plain', 7],
					['x,y', 'say "hi"'],
					['two\nlines', ''],
				],
			),
		).toBe('a,b\nplain,7\n"x,y","say ""hi"""\n"two\nlines",');
	});
});

describe('an advance’s recovery schedule', () => {
	it('shows the S9 picture: given in September, recovered by payroll to November, then planned until nothing is left', () => {
		expect(
			advanceSchedule({
				given: [{ month: '2026-09', paise: rs(5_000) }],
				recovered: { '2026-10': rs(1_000), '2026-11': rs(1_000) },
				postedThrough: '2026-11',
				perMonthPaise: rs(1_000),
			}),
		).toEqual([
			{ month: '2026-09', givenPaise: rs(5_000), recoveredPaise: 0, leftPaise: rs(5_000), how: 'none' },
			{ month: '2026-10', givenPaise: 0, recoveredPaise: rs(1_000), leftPaise: rs(4_000), how: 'payroll' },
			{ month: '2026-11', givenPaise: 0, recoveredPaise: rs(1_000), leftPaise: rs(3_000), how: 'payroll' },
			{ month: '2026-12', givenPaise: 0, recoveredPaise: rs(1_000), leftPaise: rs(2_000), how: 'planned' },
			{ month: '2027-01', givenPaise: 0, recoveredPaise: rs(1_000), leftPaise: rs(1_000), how: 'planned' },
			{ month: '2027-02', givenPaise: 0, recoveredPaise: rs(1_000), leftPaise: 0, how: 'planned' },
		]);
	});

	it('has no schedule without an advance', () => {
		expect(advanceSchedule({ given: [], recovered: {}, postedThrough: null, perMonthPaise: rs(1_000) })).toEqual(
			[],
		);
	});

	it('stops after one month when nothing is planned and nothing is posted', () => {
		expect(
			advanceSchedule({
				given: [{ month: '2026-09', paise: rs(5_000) }],
				recovered: {},
				postedThrough: null,
				perMonthPaise: 0,
			}),
		).toEqual([{ month: '2026-09', givenPaise: rs(5_000), recoveredPaise: 0, leftPaise: rs(5_000), how: 'none' }]);
	});

	it('carries on through a second advance given later, the last month taking only what is left', () => {
		expect(
			advanceSchedule({
				given: [
					{ month: '2026-11', paise: rs(2_500) },
					{ month: '2026-09', paise: rs(2_000) },
				],
				recovered: {},
				postedThrough: null,
				perMonthPaise: rs(1_000),
			}).map((m) => [m.month, m.givenPaise / 100, m.recoveredPaise / 100, m.leftPaise / 100, m.how]),
		).toEqual([
			['2026-09', 2_000, 1_000, 1_000, 'planned'],
			['2026-10', 0, 1_000, 0, 'planned'],
			['2026-11', 2_500, 1_000, 1_500, 'planned'],
			['2026-12', 0, 1_000, 500, 'planned'],
			['2027-01', 0, 500, 0, 'planned'],
		]);
	});

	it('plans at most five years ahead', () => {
		const schedule = advanceSchedule({
			given: [{ month: '2026-09', paise: rs(1_00_000) }],
			recovered: {},
			postedThrough: '2026-08',
			perMonthPaise: rs(100),
		});
		expect(schedule).toHaveLength(60);
		expect(schedule.at(-1)).toMatchObject({ month: '2031-08', leftPaise: rs(94_000), how: 'planned' });
	});
});
