import { Reflector } from '@nestjs/core';
import type { DocumentBlock, Employee, PayrollRow, PayrollRun } from '@saha-textile/contracts';
import { ourBlocks } from '@saha-textile/core-domain';
import { describe, expect, it, vi } from 'vitest';

import { PERMISSIONS_KEY } from '../src/auth/session.guard';
import type { DocumentData } from '../src/documents/document-data';
import { documentHtml } from '../src/documents/document-html';
import { payslipData, pfChargesShare, type PayslipInput } from '../src/documents/payslip-print';
import { PayrollSetupController } from '../src/payroll/payroll-setup.controller';
import { PayrollReturnsService } from '../src/payroll/payroll-returns.service';

/**
 * The payslip as a document (brief 25 PS2–PS4): every figure from the run as saved, the year to date from the person's
 * earlier runs of the year, Aadhaar never printed and PAN and the bank account masked; its tables printed with the
 * format's columns; and one person's payslip, or the whole run's, as a PDF.
 */

const refusal = (code: string) => ({ response: { message: code } });
const seller = { name: 'K.R. Marketing', lines: ['Barasat, West Bengal'] };

const row = (employeeId: string, over: Partial<PayrollRow> = {}): PayrollRow => ({
	employeeId,
	name: employeeId,
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
/** Meera in November: ₹32,000 earned over 28 of 30 days, every deduction and employer share there is. */
const MEERA_NOV = row('emp_meera', {
	name: 'Meera Das',
	paidDays: 28,
	grossPaise: 32_000_00,
	pfWagesPaise: 16_000_00,
	pfEmployeePaise: 1_800_00,
	pfEmployerPaise: 1_800_00,
	epsPaise: 1_250_00,
	esiEmployeePaise: 100_00,
	esiEmployerPaise: 400_00,
	ptPaise: 200_00,
	tdsPaise: 1_000_00,
	advancePaise: 500_00,
	lwfEmployeePaise: 3_00,
	lwfEmployerPaise: 15_00,
	gratuityPaise: 769_00,
	bonusPaise: 583_10,
	netPaise: 28_397_00,
	payslipNo: 'PS/26-27/000007',
	headsPaise: { basic: 16_000_00, da: 0, hra: 6_000_00, conveyance: 0, special: 10_000_00, other: 0 },
	tax: {
		regime: 'old',
		yearSalaryPaise: 3_84_000_00,
		deductionsPaise: 1_20_000_00,
		taxablePaise: 2_64_000_00,
		yearTaxPaise: 7_280_00,
		deductedBeforePaise: 3_000_00,
		monthsLeft: 5,
	},
});
/** October, kept before the heads were. */
const MEERA_OCT = row('emp_meera', { grossPaise: 32_000_00, pfEmployeePaise: 1_800_00, tdsPaise: 900_00 });
const MEERA: PayslipInput['employee'] = {
	code: 'E01',
	designation: 'Sales associate',
	department: 'Sarees',
	joinedOn: '2025-04-01',
	leftOn: '2027-01-31',
	pan: 'ABCDE1234F',
	uan: '100200300400',
	esiNumber: '3101234567',
	bankAccount: '5010-0012-3456-78',
	dateOfBirth: '1990-08-15',
	structure: { basic: 16_000, da: 0, hra: 6_000, special: 10_000, conveyance: 0, other: 0 },
};
const input = (over: Partial<PayslipInput> = {}): PayslipInput => ({
	seller,
	month: '2026-11',
	row: MEERA_NOV,
	earlier: [MEERA_OCT],
	employee: MEERA,
	locationName: 'Barasat',
	stateName: 'West Bengal',
	daysInMonth: 30,
	paidOn: '2026-12-01',
	rulesFrom: '2026-04-01',
	year: '2026-27',
	pfChargesPaise: 150_00,
	...over,
});
const cells = (data: DocumentData, table: 'earnings' | 'deductions' | 'employerShare' | 'taxWorking') =>
	data.payTables?.[table]?.rows.map((r) => [r.cells, !!r.zero, !!r.total]);

describe('a payslip’s figures (PS2)', () => {
	it('prints the run’s figures with the year to date, PAN and the bank account masked', () => {
		const data = payslipData(input());
		expect(data).toMatchObject({
			doc: 'payslip',
			title: 'Payslip · November 2026',
			number: 'PS/26-27/000007',
			date: 'Paid 1 Dec 2026',
			seller,
		});
		expect(data.values).toEqual({
			month: 'November 2026',
			employeeName: 'Meera Das',
			employeeCode: 'E01',
			designation: 'Sales associate',
			department: 'Sarees',
			location: 'Barasat',
			joinedOn: '1 Apr 2025',
			pan: 'ABXXXXXX4F',
			uan: '100200300400',
			esiNumber: '3101234567',
			// Its digits only, all but the last four hidden.
			paidTo: 'XXXXXXXXXX5678',
			taxRegime: 'Old (2026-27)',
			stateRules: 'West Bengal',
			dateOfBirth: '15 Aug 1990',
			leftOn: '31 Jan 2027',
			daysInMonth: '30',
			paidDays: '28',
			lossOfPay: '2',
			netPay: '₹28,397.00',
			amountInWords: expect.stringMatching(/twenty[- ]eight thousand three hundred (and )?ninety[- ]seven/i),
			rulesUsed: 'Payroll rules from 1 Apr 2026 · income tax 2026-27',
		});
		expect(cells(data, 'earnings')?.slice(0, 3)).toEqual([
			[
				{ head: 'Basic', monthlyRate: '₹16,000.00', thisMonth: '₹16,000.00', yearToDate: '₹16,000.00' },
				false,
				false,
			],
			[
				{ head: 'Dearness allowance', monthlyRate: '₹0.00', thisMonth: '₹0.00', yearToDate: '₹0.00' },
				true,
				false,
			],
			[
				{
					head: 'House rent allowance',
					monthlyRate: '₹6,000.00',
					thisMonth: '₹6,000.00',
					yearToDate: '₹6,000.00',
				},
				false,
				false,
			],
		]);
		expect(cells(data, 'earnings')?.at(-1)).toEqual([
			{ head: 'Gross', monthlyRate: '₹32,000.00', thisMonth: '₹32,000.00', yearToDate: '₹64,000.00' },
			false,
			true,
		]);
		expect(cells(data, 'deductions')).toEqual([
			[{ head: 'Provident fund', thisMonth: '₹1,800.00', yearToDate: '₹3,600.00' }, false, false],
			[{ head: 'ESI', thisMonth: '₹100.00', yearToDate: '₹100.00' }, false, false],
			[{ head: 'Professional tax (West Bengal)', thisMonth: '₹200.00', yearToDate: '₹200.00' }, false, false],
			[{ head: 'Income tax (TDS)', thisMonth: '₹1,000.00', yearToDate: '₹1,900.00' }, false, false],
			[{ head: 'Labour welfare fund', thisMonth: '₹3.00', yearToDate: '₹3.00' }, false, false],
			[{ head: 'Advance recovery', thisMonth: '₹500.00', yearToDate: '₹500.00' }, false, false],
			[{ head: 'Total deductions', thisMonth: '₹3,603.00', yearToDate: '₹6,303.00' }, false, true],
		]);
		expect(cells(data, 'employerShare')).toEqual([
			[{ head: 'Provident fund (EPF)', thisMonth: '₹550.00' }, false, false],
			[{ head: 'Pension (EPS)', thisMonth: '₹1,250.00' }, false, false],
			[{ head: 'PF admin charges and EDLI', thisMonth: '₹150.00' }, false, false],
			[{ head: 'ESI', thisMonth: '₹400.00' }, false, false],
			[{ head: 'Labour welfare fund', thisMonth: '₹15.00' }, false, false],
			[{ head: 'Gratuity provision', thisMonth: '₹769.00' }, false, false],
			[{ head: 'Bonus provision', thisMonth: '₹583.10' }, false, false],
			[{ head: 'Cost to the company this month', thisMonth: '₹35,717.10' }, false, true],
		]);
		expect(cells(data, 'taxWorking')?.map(([c]) => (c as { value: string }).value)).toEqual([
			'₹3,84,000.00',
			'−₹1,20,000.00',
			'₹2,64,000.00',
			'₹7,280.00',
			'₹3,000.00 · 5',
		]);
		expect(data.payTables?.leaveBalance?.rows).toEqual([{ cells: { kind: 'Days not paid', taken: '2' } }]);
	});

	it('prints what it can for someone no longer in the register, an unpaid run and a row with nothing kept', () => {
		const bare = row('emp_gone', { name: 'Gone', paidDays: 31, grossPaise: 9_000_00, netPaise: 9_000_00 });
		const data = payslipData(input({ row: bare, earlier: [], employee: null, paidOn: null, pfChargesPaise: 0 }));
		expect([data.number, data.date]).toEqual(['', '']);
		expect(data.values).toMatchObject({
			employeeCode: '',
			designation: '',
			department: '',
			joinedOn: '',
			pan: '',
			uan: '',
			esiNumber: '',
			paidTo: '',
			taxRegime: '',
			dateOfBirth: '',
			leftOn: '',
			// More days paid than the month has: no loss of pay.
			lossOfPay: '0',
		});
		// No heads kept and no structure: every head is nothing.
		expect(
			cells(data, 'earnings')
				?.slice(0, -1)
				.every(([, zero]) => zero),
		).toBe(true);
		expect(cells(data, 'earnings')?.at(-1)?.[0]).toMatchObject({ monthlyRate: '₹0.00', thisMonth: '₹9,000.00' });
		expect(cells(data, 'deductions')?.at(-1)?.[0]).toMatchObject({ thisMonth: '₹0.00' });
		expect(
			cells(data, 'employerShare')
				?.slice(0, -1)
				.every(([, zero]) => zero),
		).toBe(true);
		expect(cells(data, 'taxWorking')).toEqual([]);
	});

	it('masks a short bank account no further, leaves out a missing PAN, and names the new regime', () => {
		const data = payslipData(
			input({
				employee: { ...(MEERA as NonNullable<PayslipInput['employee']>), bankAccount: '1234', pan: '' },
				row: { ...MEERA_NOV, tax: { ...(MEERA_NOV.tax as NonNullable<PayrollRow['tax']>), regime: 'new' } },
			}),
		);
		expect([data.values['paidTo'], data.values['pan'], data.values['taxRegime']]).toEqual([
			'1234',
			'',
			'New (2026-27)',
		]);
	});
});

const FORMAT = { name: 'Standard', paper: 'a4' as const, blocks: ourBlocks('payslip') };
const BRAND = { logoSrc: null, themeColor: null, fontFaces: '' };
const blockOf = (type: string) => FORMAT.blocks.find((b) => b.type === type) as DocumentBlock;
const only = (...blocks: DocumentBlock[]) => ({ ...FORMAT, blocks });

describe('a payslip printed (PS3)', () => {
	it('prints our format’s strip, tables without the empty heads, net pay in words and the rules used', () => {
		const html = documentHtml(FORMAT, payslipData(input()), BRAND);
		expect(html).toContain('<section class="dz-strip">');
		expect(html).toMatch(/<section class="dz-net"><b>Net pay ₹28,397\.00<\/b><span>[^<]+<\/span><\/section>/);
		expect(html).toContain('Payroll rules from 1 Apr 2026 · income tax 2026-27');
		// Dearness allowance is nothing this month and the format doesn't ask for empty heads.
		expect(html).not.toContain('Dearness allowance');
		expect(html).toContain('<tr class="dz-pay-total">');
		// The leave balance is off in our format.
		expect(html).not.toContain('Days not paid');
	});

	it('prints empty heads when the format asks, a column it can’t name by its key, and nothing for an empty cell', () => {
		const earnings = blockOf('earnings');
		const html = documentHtml(
			only({ ...earnings, fields: ['head', 'thisMonth', 'zeroHeads', 'grade'] }),
			payslipData(input()),
			BRAND,
		);
		expect(html).toContain('Dearness allowance');
		expect(html).toContain('<th class="dz-num">grade</th>');
		expect(html).toMatch(/<td class="dz-num"><\/td><\/tr>/);
	});

	it('leaves out a table with no rows or no columns, a strip with nothing to show and net pay without a figure', () => {
		const data = payslipData(input({ row: { ...MEERA_NOV, tax: undefined } }));
		const blocks = [
			blockOf('taxWorking'),
			{ ...blockOf('earnings'), fields: ['zeroHeads'] },
			{ ...blockOf('leaveBalance'), hidden: false },
			blockOf('attendance'),
			blockOf('words'),
		];
		const body = (d: DocumentData) =>
			/<body[^>]*>([\s\S]*)<\/body>/.exec(documentHtml(only(...blocks), d, BRAND))?.[1];
		const empty = { ...data, values: {}, payTables: {} };
		expect(body(empty)).not.toMatch(/dz-pay|dz-strip|dz-net/);
		// With the tax working empty and the earnings without columns, only the leave balance prints.
		expect(body({ ...data, values: {} })?.match(/class="dz-table dz-pay"/g)).toHaveLength(1);
		// Net pay without its words.
		expect(body({ ...empty, values: { netPay: '₹10.00' } })).toContain(
			'<section class="dz-net"><b>Net pay ₹10.00</b><span></span></section>',
		);
	});
});

/** November is posted: Meera (Maharashtra's rules, at the bar), Priya (no State kept, her location gone), and a */
/** person since removed, in a State the list doesn't know. October and last March are earlier, December later. */
const NOVEMBER = {
	id: 'pay_2026-11',
	month: '2026-11',
	status: 'paid',
	paidOn: '2026-12-01',
	rows: [
		{ ...MEERA_NOV, stateCode: '27' },
		row('emp_priya', { name: 'Priya Sen', locationId: 'loc_gone', grossPaise: 18_000_00, netPaise: 18_000_00 }),
		row('emp_gone', { name: 'Gone', stateCode: '99', grossPaise: 9_000_00, netPaise: 9_000_00 }),
	],
	rulesFrom: '2026-04-01',
	voucherId: 'jv_1',
	payVoucherId: 'jv_2',
	approvedBy: 'adm_ca',
	approvedAt: '2026-11-30T06:00:00.000Z',
	createdAt: '2026-11-30T06:00:00.000Z',
	updatedAt: '2026-12-01T06:00:00.000Z',
	version: 4,
} as PayrollRun;
const runOf = (month: string, rows: PayrollRow[], over: Partial<PayrollRun> = {}) =>
	({ ...NOVEMBER, id: `pay_${month}`, month, rows, ...over }) as PayrollRun;
const RUNS = [
	runOf('2026-03', [row('emp_meera', { grossPaise: 99_000_00 })]),
	runOf('2026-10', [MEERA_OCT, row('emp_priya', { grossPaise: 18_000_00 })]),
	NOVEMBER,
	// Posted, not paid yet.
	runOf('2026-12', [row('emp_meera', { grossPaise: 77_000_00 })], { status: 'posted', paidOn: undefined }),
	runOf('2027-01', []),
];
const PEOPLE = [
	{ ...MEERA, id: 'emp_meera', name: 'Meera Das' },
	{ ...MEERA, id: 'emp_priya', name: 'Priya Sen', pan: '', bankAccount: '' },
] as Employee[];

function returns() {
	const formats = {
		seller: vi.fn(async (preview: unknown) => ({ ...(preview as object), name: 'K.R. Marketing' })),
		renderActiveCopies: vi.fn(async (_doc: string, _pages: DocumentData[]) => new Uint8Array([37, 80, 68, 70])),
	};
	const service = new PayrollReturnsService(
		{ list: async () => RUNS, get: async (month: string) => RUNS.find((r) => r.month === month) ?? null } as never,
		{ list: async () => PEOPLE } as never,
		{ list: async () => [], insert: vi.fn() } as never,
		{ get: async (id: string) => (id === 'loc_bar' ? { id, name: 'Barasat' } : null) } as never,
		{ get: async () => null } as never,
		{ forMonth: vi.fn() } as never,
		{ schedule: vi.fn() } as never,
		formats as never,
	);
	return { service, formats };
}
const pages = (formats: ReturnType<typeof returns>['formats']) => formats.renderActiveCopies.mock.calls[0]?.[1] ?? [];

describe('payslips as a PDF (PS4)', () => {
	it('prints every payslip of the run, each on its own page, in the active payslip format', async () => {
		const { service, formats } = returns();
		const file = await service.payslipsPdf('2026-11', null);
		expect(file).toEqual({ fileName: 'payslips-2026-11.pdf', data: new Uint8Array([37, 80, 68, 70]) });
		expect(formats.renderActiveCopies.mock.calls[0]?.[0]).toBe('payslip');
		expect(
			pages(formats).map((p) => [
				p.values['employeeName'],
				p.values['location'],
				p.values['stateRules'],
				p.values['employeeCode'],
				p.date,
			]),
		).toEqual([
			['Meera Das', 'Barasat', 'Maharashtra', 'E01', 'Paid 1 Dec 2026'],
			// No State kept: West Bengal's; her location is gone.
			['Priya Sen', '', 'West Bengal', 'E01', 'Paid 1 Dec 2026'],
			// Removed from the register, and a State code the list doesn't know.
			['Gone', 'Barasat', '99', '', 'Paid 1 Dec 2026'],
		]);
		expect(pages(formats).every((p) => p.seller.name === 'K.R. Marketing')).toBe(true);
	});

	it('prints one person’s payslip with the year to date from this year’s earlier runs only', async () => {
		const { service, formats } = returns();
		const file = await service.payslipsPdf('2026-11', 'emp_meera');
		expect(file.fileName).toBe('payslip-2026-11-Meera-Das.pdf');
		expect(pages(formats)).toHaveLength(1);
		const gross = pages(formats)[0]?.payTables?.earnings?.rows.at(-1)?.cells;
		// October and November: not last March, not December.
		expect(gross?.['yearToDate']).toBe('₹64,000.00');
	});

	it('finds no payslip for someone not on the run, or a run with nobody on it, and no date when it isn’t paid', async () => {
		const { service } = returns();
		await expect(service.payslipsPdf('2026-11', 'emp_nobody')).rejects.toMatchObject(refusal('payslip_not_found'));
		await expect(service.payslipsPdf('2027-01', null)).rejects.toMatchObject(refusal('payslip_not_found'));
		await expect(service.payslipsPdf('2025-01', null)).rejects.toMatchObject(refusal('payroll_run_not_found'));
		const { service: unpaid, formats } = returns();
		await unpaid.payslipsPdf('2026-12', 'emp_meera');
		expect(pages(formats)[0]?.date).toBe('');
	});

	it('sends the PDF from GET runs/:month/payslips.pdf to anyone who may see the accounts', async () => {
		const file = { fileName: 'payslips-2026-11.pdf', data: new Uint8Array([1, 2]) };
		const service = { payslipsPdf: vi.fn(async () => file) };
		const controller = new PayrollSetupController({} as never, {} as never, service as never, {} as never);
		const sent: { headers: Record<string, string>; body?: unknown } = { headers: {} };
		const reply = {
			header(name: string, value: string) {
				sent.headers[name] = value;
				return reply;
			},
			send(body: unknown) {
				sent.body = body;
				return reply;
			},
		};
		await controller.payslipsPdf('2026-11', undefined, reply as never);
		await controller.payslipsPdf('2026-11', '', reply as never);
		await controller.payslipsPdf('2026-11', 'emp_meera', reply as never);
		expect(service.payslipsPdf.mock.calls).toEqual([
			['2026-11', null],
			['2026-11', null],
			['2026-11', 'emp_meera'],
		]);
		expect(sent).toEqual({
			headers: {
				'Content-Type': 'application/pdf',
				'Content-Disposition': 'attachment; filename="payslips-2026-11.pdf"',
				'Cache-Control': 'no-store',
			},
			body: Buffer.from([1, 2]),
		});
		expect(new Reflector().get(PERMISSIONS_KEY, PayrollSetupController.prototype.payslipsPdf)).toEqual([
			'accounts.index',
		]);
		expect(Reflect.getMetadata('path', PayrollSetupController.prototype.payslipsPdf)).toBe(
			'runs/:month/payslips.pdf',
		);
	});
});

describe("a person's share of the PF admin charges and EDLI", () => {
	const member = (pfEmployeePaise: number) => ({ ...MEERA_NOV, pfEmployeePaise });
	it("shares the run's charges by each member's PF, the ₹500 admin minimum included", () => {
		const one = member(1_044_00);
		const two = member(522_00);
		const run = { rows: [one, two, member(0)], pfAdminPaise: 500_00, edliPaise: 65_25 };
		// ₹565.25 shared 2:1.
		expect(pfChargesShare(run, one)).toBe(376_83);
		expect(pfChargesShare(run, two)).toBe(188_42);
	});
	it('is nothing for someone without PF, or a run that kept no charges', () => {
		const one = member(1_044_00);
		expect(pfChargesShare({ rows: [one, member(0)], pfAdminPaise: 500_00, edliPaise: 0 }, member(0))).toBe(0);
		expect(pfChargesShare({ rows: [one] }, one)).toBe(0);
	});
});
