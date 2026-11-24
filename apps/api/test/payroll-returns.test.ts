import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import type { Employee, PayrollRow, PayrollRun } from '@saha-textile/contracts';
import { describe, expect, it, vi } from 'vitest';

import { BUILT_IN_PAYROLL_RULES, rulesOf } from '../src/payroll/payroll-rules.service';
import { PayrollReturnsService } from '../src/payroll/payroll-returns.service';

/** Payslips (accounts brief S6), the schemes (S2) and the statutory returns with their portal files (S7). */

const refusal = (code: string) => ({ response: { message: code } });
const ca = { userId: 'adm_ca', permissions: ['accounts.post'] } as never;

const employee = (id: string, name: string, each: number, over: Partial<Employee> = {}) =>
	({
		id,
		name,
		code: '',
		locationId: 'loc_bar',
		joinedOn: '2025-04-01',
		leftOn: null,
		pan: '',
		uan: '',
		esiNumber: '',
		bankAccount: '',
		ifsc: '',
		pfOn: true,
		structure: { basic: each, da: 0, hra: 0, special: each, conveyance: 0, other: 0 },
		...over,
	}) as Employee;
const PEOPLE = [
	employee('emp_meera', 'Meera', 16_000, {
		code: 'E01',
		pan: 'ABCDE1234F',
		uan: '100200300400',
		bankAccount: '50100012345678',
		ifsc: 'HDFC0001234',
	}),
	// Within the ESI limit; left during November.
	employee('emp_priya', 'Priya', 9_000, { uan: '100200300401', esiNumber: '3101234567', leftOn: '2026-11-20' }),
	employee('emp_rahul', 'Rahul', 8_000, { bankAccount: '1234', ifsc: 'ZZZZ0000001', leftOn: '2026-10-15' }),
	// Not on November's roll: joined after it, or left before it.
	employee('emp_new', 'Newcomer', 8_000, { joinedOn: '2026-12-01' }),
	employee('emp_old', 'Old hand', 8_000, { leftOn: '2026-10-31' }),
];

const row = (employeeId: string, name: string, over: Partial<PayrollRow> = {}): PayrollRow => ({
	employeeId,
	name,
	locationId: 'loc_bar',
	paidDays: 30,
	grossPaise: 0,
	pfWagesPaise: 0,
	pfEmployeePaise: 0,
	pfEmployerPaise: 0,
	epsPaise: 0,
	esiEmployeePaise: 0,
	esiEmployerPaise: 0,
	ptPaise: 0,
	tdsPaise: 0,
	advancePaise: 0,
	netPaise: 0,
	...over,
});
const MEERA_NOV = row('emp_meera', 'Meera', {
	grossPaise: 3_200_000,
	pfWagesPaise: 1_600_000,
	pfEmployeePaise: 180_000,
	pfEmployerPaise: 180_000,
	epsPaise: 125_000,
	ptPaise: 15_000,
	netPaise: 3_005_000,
	lwfEmployeePaise: 0,
	lwfEmployerPaise: 0,
	headsPaise: { basic: 1_600_000, da: 0, hra: 0, conveyance: 0, special: 1_600_000, other: 0 },
});
/** A row saved before the heads were kept: they are worked out from her structure. */
const PRIYA_NOV = row('emp_priya', 'Priya', {
	paidDays: 29,
	grossPaise: 1_740_000,
	pfWagesPaise: 870_000,
	pfEmployeePaise: 104_400,
	pfEmployerPaise: 104_400,
	epsPaise: 0,
	esiEmployeePaise: 13_100,
	esiEmployerPaise: 56_600,
	ptPaise: 13_000,
	tdsPaise: 5_000,
	advancePaise: 100_000,
	netPaise: 1_504_500,
});
/** Someone no longer in the register. */
const GONE_NOV = row('emp_gone', 'Gone', {
	grossPaise: 900_000,
	tdsPaise: 2_000,
	esiEmployeePaise: 6_800,
	netPaise: 891_200,
});

const run = (month: string, status: string, rows: PayrollRow[], over: Partial<PayrollRun> = {}) =>
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
		createdAt: '2026-12-01T06:00:00.000Z',
		updatedAt: '2026-12-01T06:00:00.000Z',
		version: 1,
		...over,
	}) as PayrollRun;
const RUNS = [
	run('2026-09', 'posted', [row('emp_meera', 'Meera', { tdsPaise: 1_000, grossPaise: 3_200_000 })]),
	// Saved before the EPF charges and welfare fund were kept: none of those for October.
	run('2026-10', 'posted', [
		row('emp_meera', 'Meera', { pfEmployeePaise: 180_000, pfEmployerPaise: 180_000, ptPaise: 15_000 }),
	]),
	run('2026-11', 'paid', [MEERA_NOV, PRIYA_NOV, GONE_NOV], {
		paidOn: '2026-12-01',
		schemesFrom: '2026-04-01',
		pfAdminPaise: 50_000,
		edliPaise: 23_400,
	}),
	// December: the welfare fund, one row without the employer's share kept.
	run('2026-12', 'posted', [
		row('emp_meera', 'Meera', { lwfEmployeePaise: 300, lwfEmployerPaise: 1_500, grossPaise: 3_200_000 }),
		row('emp_priya', 'Priya', { lwfEmployeePaise: 300, advancePaise: 100_000, grossPaise: 1_740_000 }),
	]),
	run('2027-01', 'draft', [MEERA_NOV]),
];

function build(
	options: {
		runs?: PayrollRun[];
		filings?: unknown[];
		shop?: unknown;
		insertFails?: unknown;
	} = {},
) {
	const runs = options.runs ?? RUNS;
	const filings = {
		list: async () => options.filings ?? [],
		insert: vi.fn(async () => {
			if (options.insertFails !== undefined) throw options.insertFails;
		}),
	};
	const advances = {
		schedule: vi.fn(async () => ({
			rows: [
				{ month: '2026-09', recoveredPaise: 0 },
				{ month: '2026-10', recoveredPaise: 100_000 },
				{ month: '2026-11', recoveredPaise: 100_000 },
				{ month: '2026-12', recoveredPaise: 0 },
			],
		})),
	};
	const service = new PayrollReturnsService(
		{ list: async () => runs, get: async (month: string) => runs.find((r) => r.month === month) ?? null } as never,
		{ list: async () => PEOPLE } as never,
		filings as never,
		{ get: async (id: string) => (id === 'loc_bar' ? { id, name: 'Barasat' } : null) } as never,
		{
			get: async () =>
				options.shop === undefined ? { legalName: 'K.R. Marketing', tradeName: 'Saha Textile' } : options.shop,
		} as never,
		{ forMonth: async () => rulesOf(BUILT_IN_PAYROLL_RULES) } as never,
		advances as never,
	);
	return { service, filings, advances };
}

describe('which schemes apply (S2)', () => {
	it('counts only the people on the month’s roll, and those within ESI’s wage limit', async () => {
		const lines = await build().service.schemes('2026-11');
		expect(lines.map((l) => [l.scheme, l.headcount, l.eligible, l.status])).toEqual([
			['pf', 2, null, 'voluntary'],
			['esi', 2, 1, 'not_yet'],
			['bonus', 2, null, 'not_yet'],
			['gratuity', 2, null, 'not_yet'],
			['pt', 2, null, 'applies'],
			['lwf', 2, null, 'applies'],
		]);
	});
});

describe('payslips (S6)', () => {
	it('prints the heads kept with the run, PF on its capped wages, and the bank the pay went to', async () => {
		const slip = await build().service.payslip('2026-11', 'emp_meera');
		expect(slip).toMatchObject({
			month: '2026-11',
			company: 'K.R. Marketing',
			name: 'Meera',
			code: 'E01',
			location: 'Barasat',
			uan: '100200300400',
			daysInMonth: 30,
			paidDays: 30,
			earnings: [
				{ head: 'basic', paise: 1_600_000 },
				{ head: 'special', paise: 1_600_000 },
			],
			grossPaise: 3_200_000,
			deductions: [
				{ key: 'pf', paise: 180_000, wagesPaise: 1_500_000, recovery: null },
				{ key: 'pt', paise: 15_000, wagesPaise: null, recovery: null },
			],
			totalDeductionsPaise: 195_000,
			netPaise: 3_005_000,
			paidTo: { bank: 'HDFC Bank', last4: '5678' },
			paidOn: '2026-12-01',
			rulesFrom: '2026-04-01',
			schemesFrom: '2026-04-01',
			status: 'paid',
		});
		expect(slip.netWords).toMatch(/thirty thousand fifty/i);
	});

	it('works the heads out for an older row, and counts which recovery of her advance this month is', async () => {
		const slip = await build({ shop: { legalName: '', tradeName: 'Saha Textile' } }).service.payslip(
			'2026-11',
			'emp_priya',
		);
		expect(slip.company).toBe('Saha Textile');
		expect(slip.earnings).toEqual([
			{ head: 'basic', paise: 870_000 },
			{ head: 'special', paise: 870_000 },
		]);
		expect(slip.deductions.map((d) => [d.key, d.paise, d.recovery])).toEqual([
			['pf', 104_400, null],
			['esi', 13_100, null],
			['pt', 13_000, null],
			['tds', 5_000, null],
			['advance', 100_000, { n: 2, of: 2 }],
		]);
		// No bank number: no "paid to".
		expect(slip.paidTo).toBeNull();
	});

	it('shows no recovery count in a month not yet recovered, and the welfare fund when deducted', async () => {
		const slip = await build({ shop: null }).service.payslip('2026-12', 'emp_priya');
		expect(slip).toMatchObject({ company: '', paidOn: null, schemesFrom: null, status: 'posted' });
		expect(slip.deductions).toEqual([
			{ key: 'lwf', paise: 300, wagesPaise: null, recovery: null },
			{ key: 'advance', paise: 100_000, wagesPaise: null, recovery: null },
		]);
	});

	it('prints someone gone from the register with what the run kept, and names a bank only it knows', async () => {
		const gone = await build().service.payslip('2026-11', 'emp_gone');
		expect(gone).toMatchObject({ code: '', uan: '', earnings: [], paidTo: null });
		const rahul = row('emp_rahul', 'Rahul', { locationId: 'loc_shop', grossPaise: 1_600_000, netPaise: 1_600_000 });
		const shop = await build({ runs: [run('2026-10', 'posted', [rahul])] }).service.payslip('2026-10', 'emp_rahul');
		expect(shop).toMatchObject({ location: '', paidTo: { bank: 'ZZZZ0000001', last4: '1234' } });
	});

	it('refuses a month with no run and someone not in it', async () => {
		const { service } = build();
		const noRun = service.payslip('2026-05', 'emp_meera');
		await expect(noRun).rejects.toBeInstanceOf(NotFoundException);
		await expect(noRun).rejects.toMatchObject(refusal('payroll_run_not_found'));
		await expect(service.payslip('2026-11', 'emp_new')).rejects.toMatchObject(refusal('payslip_not_found'));
	});
});

describe('the statutory returns (S7)', () => {
	it('lists each posted month’s returns with something to pay, and TDS by quarter, by due day', async () => {
		const filings = [{ kind: 'pf', period: '2026-10', filedOn: '2026-11-14', reference: 'TRRN-9' }];
		const returns = await build({ filings }).service.returns(new Date('2027-01-15T06:00:00.000Z'));
		expect(returns.map((r) => [r.kind, r.period, r.due, r.amountPaise, r.status])).toEqual([
			['tds', '2026-07', '2026-10-31', 1_000, 'ready'],
			['pf', '2026-10', '2026-11-15', 360_000, 'filed'],
			['pt', '2026-10', '2026-11-21', 15_000, 'ready'],
			// November: PF with the EPF charges, ESI, professional tax.
			['esi', '2026-11', '2026-12-15', 13_100 + 56_600 + 6_800, 'ready'],
			['pf', '2026-11', '2026-12-15', 568_800 + 50_000 + 23_400, 'ready'],
			['pt', '2026-11', '2026-12-21', 28_000, 'ready'],
			['lwf', '2026-12', '2027-01-15', 2_100, 'ready'],
			['tds', '2026-10', '2027-01-31', 7_000, 'ready'],
		]);
		expect(returns[1]).toMatchObject({ filedOn: '2026-11-14', reference: 'TRRN-9', periodTo: '2026-10' });
		expect(returns[0]).toMatchObject({ periodTo: '2026-09', filedOn: null, reference: '' });
		expect(returns.at(-1)).toMatchObject({ periodTo: '2026-12', filedOn: null, reference: '' });
	});

	it('waits on a quarter’s TDS until the quarter is over, by the month in India', async () => {
		const returns = await build().service.returns(new Date('2026-12-31T20:00:00.000Z'));
		// 1:30 am on 1 January in India: the October quarter is over.
		expect(returns.find((r) => r.kind === 'tds' && r.period === '2026-10')?.status).toBe('ready');
		const before = await build().service.returns(new Date('2026-12-31T06:00:00.000Z'));
		expect(before.find((r) => r.kind === 'tds' && r.period === '2026-10')?.status).toBe('later');
		expect((await build().service.returns()).length).toBeGreaterThan(0);
	});
});

describe('the portal files (S7)', () => {
	it('writes the quarter’s TDS statement from the posted months, in month order', async () => {
		const file = await build().service.file('tds', '2026-11');
		expect(file.fileName).toBe('24Q-2026-10-to-2026-12.csv');
		expect(file.text.split('\n')).toEqual([
			'PAN,Employee,Month,Paid on,Salary paid,TDS deducted',
			',Priya,2026-11,2026-12-01,17400,50',
			',Gone,2026-11,2026-12-01,9000,20',
		]);
	});

	it('leaves the day paid empty for a month posted but not paid yet', async () => {
		const file = await build().service.file('tds', '2026-08');
		expect(file.text.split('\n')[1]).toBe('ABCDE1234F,Meera,2026-09,,32000,10');
	});

	it('leaves the numbers empty for someone gone from the register', async () => {
		const gone = row('emp_gone', 'Gone', {
			grossPaise: 900_000,
			pfWagesPaise: 900_000,
			pfEmployeePaise: 108_000,
			pfEmployerPaise: 108_000,
			ptPaise: 11_000,
		});
		const { service } = build({ runs: [run('2026-11', 'posted', [gone])] });
		expect((await service.file('pf', '2026-11')).text).toBe(
			'#~#GONE#~#9000#~#9000#~#0#~#9000#~#1080#~#0#~#1080#~#0#~#0',
		);
		expect((await service.file('pt', '2026-11')).text.split('\n')[1]).toBe('Gone,,9000,110');
	});

	it('writes the PF ECR with capped wages, no pension wages when there is no pension, and days not worked', async () => {
		const file = await build().service.file('pf', '2026-11');
		expect(file.fileName).toBe('ECR-2026-11.txt');
		expect(file.text.split('\n')).toEqual([
			'100200300400#~#MEERA#~#32000#~#15000#~#15000#~#15000#~#1800#~#1250#~#550#~#0#~#0',
			'100200300401#~#PRIYA#~#17400#~#8700#~#0#~#8700#~#1044#~#0#~#1044#~#1#~#0',
		]);
	});

	it('writes the ESIC upload, the last working day only for someone who left in the month', async () => {
		const file = await build().service.file('esi', '2026-11');
		expect(file.fileName).toBe('ESIC-2026-11.csv');
		expect(file.text.split('\n').slice(1)).toEqual(['3101234567,Priya,29,17400,2,20/11/2026', ',Gone,30,9000,0,']);
		const october = row('emp_rahul', 'Rahul', { esiEmployeePaise: 100, grossPaise: 1_600_000 });
		const left = await build({ runs: [run('2026-11', 'posted', [october])] }).service.file('esi', '2026-11');
		// He left in October: no last working day in November's file.
		expect(left.text.split('\n')[1]).toBe(',Rahul,30,16000,0,');
	});

	it('writes professional tax and the welfare fund as CSV', async () => {
		const pt = await build().service.file('pt', '2026-11');
		expect(pt).toEqual({
			fileName: 'PT-2026-11.csv',
			text: 'Employee,PAN,Gross salary,Professional tax\nMeera,ABCDE1234F,32000,150\nPriya,,17400,130',
		});
		const lwf = await build().service.file('lwf', '2026-12');
		expect(lwf).toEqual({
			fileName: 'LWF-2026-12.csv',
			text: 'Employee,Employee share,Employer share\nMeera,3,15\nPriya,3,0',
		});
		const none = await build().service.file('lwf', '2026-11');
		expect(none.text).toBe('Employee,Employee share,Employer share');
	});

	it('needs a posted run for a monthly file', async () => {
		const { service } = build();
		await expect(service.file('pf', '2027-01')).rejects.toMatchObject(refusal('payroll_not_posted'));
		await expect(service.file('pf', '2027-02')).rejects.toBeInstanceOf(NotFoundException);
	});
});

describe('marking a return filed (S7)', () => {
	const filing = { filedOn: '2026-12-14', reference: 'TRRN-12' };
	const after = new Date('2027-01-15T06:00:00.000Z');

	it('marks a ready return filed once, with who and when', async () => {
		const { service, filings } = build();
		expect(await service.markFiled('pf', '2026-11', filing, ca, after)).toMatchObject({
			kind: 'pf',
			period: '2026-11',
			status: 'filed',
			filedOn: '2026-12-14',
			reference: 'TRRN-12',
		});
		expect(filings.insert).toHaveBeenCalledWith({
			kind: 'pf',
			period: '2026-11',
			filedOn: '2026-12-14',
			reference: 'TRRN-12',
			filedBy: 'adm_ca',
			filedAt: after.toISOString(),
		});
		const nobody = build();
		await nobody.service.markFiled('pt', '2026-11', filing, undefined);
		expect(nobody.filings.insert).toHaveBeenCalledWith(expect.objectContaining({ filedBy: null }));
	});

	it('refuses a return that isn’t there, one filed already, and one not due yet', async () => {
		const missing = build().service.markFiled('pf', '2026-05', filing, ca, after);
		await expect(missing).rejects.toBeInstanceOf(NotFoundException);
		await expect(missing).rejects.toMatchObject(refusal('statutory_return_not_found'));
		const filed = build({ filings: [{ kind: 'pf', period: '2026-11', filedOn: '2026-12-14', reference: 'X' }] });
		await expect(filed.service.markFiled('pf', '2026-11', filing, ca, after)).rejects.toBeInstanceOf(
			ConflictException,
		);
		const early = build().service.markFiled('tds', '2026-10', filing, ca, new Date('2026-12-15T06:00:00.000Z'));
		await expect(early).rejects.toBeInstanceOf(BadRequestException);
		await expect(early).rejects.toMatchObject(refusal('statutory_not_due_yet'));
	});

	it('says it was filed already when someone else just did, and passes on any other failure', async () => {
		const raced = build({ insertFails: new Error('statutory_already_filed') }).service.markFiled(
			'pf',
			'2026-11',
			filing,
			ca,
			after,
		);
		await expect(raced).rejects.toBeInstanceOf(ConflictException);
		await expect(raced).rejects.toMatchObject(refusal('statutory_already_filed'));
		const diskFull = new Error('disk full');
		await expect(
			build({ insertFails: diskFull }).service.markFiled('pf', '2026-11', filing, ca, after),
		).rejects.toBe(diskFull);
		const odd = { code: 'not an error' };
		await expect(build({ insertFails: odd }).service.markFiled('pf', '2026-11', filing, ca, after)).rejects.toBe(
			odd,
		);
	});
});
