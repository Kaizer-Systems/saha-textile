import type { Employee, PayrollRow, PayrollRun } from '@saha-textile/contracts';
import { SALARY_HEADS, rupeesInWords } from '@saha-textile/core-domain';

import type { DocumentData } from './document-data';

/**
 * A payslip as every payslip format reads it (brief 25 PS2, approved 2026-11-25). Every figure comes from the run as
 * saved: the heads paid, the deductions, what the employer pays on top, and the income-tax working the run used; the
 * year to date adds the person's earlier runs of the financial year. Aadhaar is never printed; PAN shows its first two
 * and last two characters, the bank account its last four digits.
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "Sep 2026". */
const monthShort = (month: string) => `${MONTHS[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;
const money = (paise: number) =>
	`₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const day = (iso: string | null | undefined) =>
	iso
		? new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-IN', {
				day: 'numeric',
				month: 'short',
				year: 'numeric',
				timeZone: 'UTC',
			})
		: '';
const monthName = (month: string) =>
	new Date(`${month}-01T00:00:00Z`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });

const HEAD_NAMES: Record<(typeof SALARY_HEADS)[number], string> = {
	basic: 'Basic',
	da: 'Dearness allowance',
	hra: 'House rent allowance',
	conveyance: 'Conveyance',
	special: 'Special allowance',
	other: 'Other allowance',
};

export interface PayslipInput {
	seller: DocumentData['seller'];
	month: string;
	row: PayrollRow;
	/** The person's rows in the earlier runs of the financial year. */
	earlier: readonly PayrollRow[];
	employee: Pick<
		Employee,
		| 'code'
		| 'designation'
		| 'department'
		| 'joinedOn'
		| 'leftOn'
		| 'pan'
		| 'uan'
		| 'esiNumber'
		| 'bankAccount'
		| 'dateOfBirth'
		| 'structure'
	> | null;
	locationName: string;
	stateName: string;
	daysInMonth: number;
	paidOn: string | null;
	rulesFrom: string;
	/** The financial year, `2026-27`. */
	year: string;
	/** The person's share of the run's EPF admin charges and EDLI (`pfChargesShare`). */
	pfChargesPaise: number;
}

/**
 * A person's share of the run's EPF admin charges and EDLI (PS2's "0.5% each"): the run's charges shared by each
 * member's PF, which is 12% of their capped PF wages, so the shares follow those wages and add up to what the run
 * posted, the establishment's ₹500 admin minimum included.
 */
export function pfChargesShare(run: Pick<PayrollRun, 'rows' | 'pfAdminPaise' | 'edliPaise'>, row: PayrollRow): number {
	const total = (run.pfAdminPaise ?? 0) + (run.edliPaise ?? 0);
	if (!total || row.pfEmployeePaise <= 0) return 0;
	const members = run.rows.reduce((sum, r) => sum + r.pfEmployeePaise, 0);
	return Math.round((total * row.pfEmployeePaise) / members);
}

const masked = (value: string, keep: number) =>
	value.length > keep ? `${'X'.repeat(value.length - keep)}${value.slice(-keep)}` : value;

export function payslipData(input: PayslipInput): DocumentData {
	const { row, earlier, employee } = input;
	const ytd = (pick: (r: PayrollRow) => number) => earlier.reduce((sum, r) => sum + pick(r), 0) + pick(row);
	const headPaid = (r: PayrollRow, head: string) => r.headsPaise?.[head] ?? 0;
	const earnings = SALARY_HEADS.map((head) => {
		const rate = Math.round((employee?.structure[head] ?? 0) * 100);
		const now = headPaid(row, head);
		return {
			cells: {
				head: HEAD_NAMES[head],
				monthlyRate: money(rate),
				thisMonth: money(now),
				yearToDate: money(ytd((r) => headPaid(r, head))),
			},
			zero: !now && !rate,
		};
	});
	// Brief 26 SR4: arrears of a revision dated back, one line with the months they are for.
	const arrearsMonths = (row.arrearsFor ?? []).map((a) => monthShort(a.month)).join(', ');
	// Brief 26 SR4: arrears for an earlier financial year are taxed now; the employee may claim relief (s.89, Form 10E).
	const fyOf = (m: string) => (Number(m.slice(5, 7)) >= 4 ? Number(m.slice(0, 4)) : Number(m.slice(0, 4)) - 1);
	const earlierYears = [
		...new Set((row.arrearsFor ?? []).map((a) => fyOf(a.month)).filter((y) => y < fyOf(input.month))),
	]
		.sort()
		.map((y) => `${y}-${String((y + 1) % 100).padStart(2, '0')}`);
	const relief = earlierYears.length
		? ` · of FY ${earlierYears.join(', ')}: taxed this year; relief under section 89 (Form 10E) may be claimed`
		: '';
	earnings.push({
		cells: {
			head: arrearsMonths ? `Arrears (${arrearsMonths})${relief}` : 'Arrears',
			monthlyRate: money(0),
			thisMonth: money(row.arrearsPaise ?? 0),
			yearToDate: money(ytd((r) => r.arrearsPaise ?? 0)),
		},
		zero: !row.arrearsPaise,
	});
	const monthlyRate = Math.round(Object.values(employee?.structure ?? {}).reduce((s, v) => s + v, 0) * 100);
	const deduction = (head: string, pick: (r: PayrollRow) => number) => {
		const now = pick(row);
		return { cells: { head, thisMonth: money(now), yearToDate: money(ytd(pick)) }, zero: !now };
	};
	const totalDeductions = (r: PayrollRow) =>
		r.pfEmployeePaise + r.esiEmployeePaise + r.ptPaise + r.tdsPaise + (r.lwfEmployeePaise ?? 0) + r.advancePaise;
	const employerPf = row.pfEmployerPaise - row.epsPaise;
	const pfCharges = input.pfChargesPaise;
	const employerTotal =
		row.pfEmployerPaise +
		pfCharges +
		row.esiEmployerPaise +
		(row.gratuityPaise ?? 0) +
		(row.bonusPaise ?? 0) +
		(row.lwfEmployerPaise ?? 0);
	const tax = row.tax;
	return {
		doc: 'payslip',
		title: `Payslip · ${monthName(input.month)}`,
		number: row.payslipNo ?? '',
		date: input.paidOn ? `Paid ${day(input.paidOn)}` : '',
		seller: input.seller,
		values: {
			month: monthName(input.month),
			employeeName: row.name,
			employeeCode: employee?.code ?? '',
			designation: employee?.designation ?? '',
			department: employee?.department ?? '',
			location: input.locationName,
			joinedOn: day(employee?.joinedOn),
			pan: employee?.pan ? `${employee.pan.slice(0, 2)}XXXXXX${employee.pan.slice(-2)}` : '',
			uan: employee?.uan ?? '',
			esiNumber: employee?.esiNumber ?? '',
			paidTo: employee?.bankAccount ? masked(employee.bankAccount.replace(/\D/g, ''), 4) : '',
			taxRegime: tax ? `${tax.regime === 'new' ? 'New' : 'Old'} (${input.year})` : '',
			stateRules: input.stateName,
			dateOfBirth: day(employee?.dateOfBirth),
			leftOn: day(employee?.leftOn),
			daysInMonth: String(input.daysInMonth),
			paidDays: String(row.paidDays),
			lossOfPay: String(Math.max(0, input.daysInMonth - row.paidDays)),
			netPay: money(row.netPaise),
			amountInWords: rupeesInWords(row.netPaise / 100),
			rulesUsed: `Payroll rules from ${day(input.rulesFrom)} · income tax ${input.year}`,
		},
		parties: {},
		payTables: {
			earnings: {
				rows: [
					...earnings,
					{
						cells: {
							head: 'Gross',
							monthlyRate: money(monthlyRate),
							thisMonth: money(row.grossPaise),
							yearToDate: money(ytd((r) => r.grossPaise)),
						},
						total: true,
					},
				],
			},
			deductions: {
				rows: [
					deduction('Provident fund', (r) => r.pfEmployeePaise),
					deduction('ESI', (r) => r.esiEmployeePaise),
					deduction(`Professional tax (${input.stateName})`, (r) => r.ptPaise),
					deduction('Income tax (TDS)', (r) => r.tdsPaise),
					deduction('Labour welfare fund', (r) => r.lwfEmployeePaise ?? 0),
					deduction('Advance recovery', (r) => r.advancePaise),
					{
						cells: {
							head: 'Total deductions',
							thisMonth: money(totalDeductions(row)),
							yearToDate: money(ytd(totalDeductions)),
						},
						total: true,
					},
				],
			},
			employerShare: {
				rows: [
					{ cells: { head: 'Provident fund (EPF)', thisMonth: money(employerPf) }, zero: !employerPf },
					{ cells: { head: 'Pension (EPS)', thisMonth: money(row.epsPaise) }, zero: !row.epsPaise },
					{ cells: { head: 'PF admin charges and EDLI', thisMonth: money(pfCharges) }, zero: !pfCharges },
					{ cells: { head: 'ESI', thisMonth: money(row.esiEmployerPaise) }, zero: !row.esiEmployerPaise },
					{
						cells: { head: 'Labour welfare fund', thisMonth: money(row.lwfEmployerPaise ?? 0) },
						zero: !row.lwfEmployerPaise,
					},
					{
						cells: { head: 'Gratuity provision', thisMonth: money(row.gratuityPaise ?? 0) },
						zero: !row.gratuityPaise,
					},
					{
						cells: { head: 'Bonus provision', thisMonth: money(row.bonusPaise ?? 0) },
						zero: !row.bonusPaise,
					},
					{
						cells: {
							head: 'Cost to the company this month',
							thisMonth: money(row.grossPaise + employerTotal),
						},
						total: true,
					},
				],
			},
			taxWorking: {
				rows: tax
					? [
							{
								cells: {
									label: 'Salary for the year (paid and expected)',
									value: money(tax.yearSalaryPaise),
								},
							},
							{ cells: { label: 'Exemptions and deductions', value: `−${money(tax.deductionsPaise)}` } },
							{ cells: { label: 'Taxable income', value: money(tax.taxablePaise) } },
							{ cells: { label: 'Tax for the year', value: money(tax.yearTaxPaise) } },
							{
								cells: {
									label: `Deducted before this month · months left with this one`,
									value: `${money(tax.deductedBeforePaise)} · ${tax.monthsLeft}`,
								},
							},
						]
					: [],
			},
			leaveBalance: {
				rows: [
					{
						cells: { kind: 'Days not paid', taken: String(Math.max(0, input.daysInMonth - row.paidDays)) },
					},
				],
			},
		},
	};
}
