import { randomUUID } from 'node:crypto';

import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type {
	Attendance,
	AttendanceWrite,
	Employee,
	EmployeeEdit,
	EmployeeView,
	EmployeeWrite,
	BonusPay,
	BonusYear,
	BonusYearRow,
	IncomeTaxView,
	PayrollRow,
	PayrollRun,
	PayrollStep,
} from '@saha-textile/contracts';
import {
	ageBand,
	bonusDue,
	bonusOn,
	bonusWages,
	financialYearOf,
	gratuityProvision,
	monthPay,
	monthlyTds,
	monthsAfter,
	payslipHeads,
	proofDue,
	taxForYear,
	pfEstablishmentCharges,
	resolveRole,
	stateLwf,
	statePt,
	stateRulesFor,
	type AttendanceRepository,
	type AuditLogRepository,
	type EmployeeRepository,
	type IncomeTaxRules,
	type LocationRepository,
	type PayrollRunRepository,
	type TransactionManagerPort,
} from '@saha-textile/core-domain';

import type { AuthenticatedPrincipal } from '../auth/session.guard';
import {
	ATTENDANCE_REPOSITORY,
	AUDIT_LOG_REPOSITORY,
	EMPLOYEE_REPOSITORY,
	LOCATION_REPOSITORY,
	PAYROLL_RUN_REPOSITORY,
	TRANSACTION_MANAGER,
} from '../infra/tokens';
import { accountsRefusal } from '../ledger/accounts-refusal';
import { LedgerService } from '../ledger/ledger.service';
import { PayrollRulesService } from './payroll-rules.service';

const refuse = (code: string) => new BadRequestException(accountsRefusal(code));
const paise = (inr: number) => Math.round(inr * 100);
const daysIn = (month: string) => {
	const [y, m] = month.split('-').map(Number) as [number, number];
	return new Date(Date.UTC(y, m, 0)).getUTCDate();
};
const monthEnd = (month: string) => `${month}-${String(daysIn(month)).padStart(2, '0')}`;
const mask = (value: string) => (value ? `••••${value.slice(-4)}` : '');

/** The payroll ledgers, by name, and the group each sits in. */
export const PAYROLL_LEDGERS = {
	salaries: { name: 'Salaries and wages', group: 'indirect_expenses' },
	employerPf: { name: 'Employer PF contribution', group: 'indirect_expenses' },
	employerEsi: { name: 'Employer ESI contribution', group: 'indirect_expenses' },
	salaryPayable: { name: 'Salary payable', group: 'current_liabilities' },
	pfPayable: { name: 'PF payable', group: 'current_liabilities' },
	esiPayable: { name: 'ESI payable', group: 'current_liabilities' },
	ptPayable: { name: 'Professional tax payable', group: 'current_liabilities' },
	employerLwf: { name: 'Employer labour welfare fund', group: 'indirect_expenses' },
	lwfPayable: { name: 'Labour welfare fund payable', group: 'current_liabilities' },
	gratuity: { name: 'Gratuity', group: 'indirect_expenses' },
	gratuityProvision: { name: 'Provision for gratuity', group: 'provisions' },
	bonus: { name: 'Bonus', group: 'indirect_expenses' },
	bonusPayable: { name: 'Bonus payable', group: 'provisions' },
} as const;

/** One person's pay so far in the financial year, from the runs before this month (TX). */
export interface YearToDate {
	grossPaise: number;
	tdsPaise: number;
	pfPaise: number;
	ptPaise: number;
	hraPaise: number;
	basicDaPaise: number;
}

export function yearToDate(runs: readonly PayrollRun[], employeeId: string): YearToDate {
	const out: YearToDate = { grossPaise: 0, tdsPaise: 0, pfPaise: 0, ptPaise: 0, hraPaise: 0, basicDaPaise: 0 };
	for (const row of runs.flatMap((r) => r.rows).filter((r) => r.employeeId === employeeId)) {
		out.grossPaise += row.grossPaise;
		out.tdsPaise += row.tdsPaise;
		out.pfPaise += row.pfEmployeePaise;
		out.ptPaise += row.ptPaise;
		out.hraPaise += row.headsPaise?.['hra'] ?? 0;
		out.basicDaPaise += (row.headsPaise?.['basic'] ?? 0) + (row.headsPaise?.['da'] ?? 0);
	}
	return out;
}

/** A month's pay figures the year's tax reads: gross, own PF, professional tax, HRA, basic and DA. */
export interface MonthFigures {
	grossPaise: number;
	pfPaise: number;
	ptPaise: number;
	hraPaise: number;
	basicDaPaise: number;
}

/**
 * TX1: the year's tax for one person and this month's share. The year is what was paid in the earlier months, this
 * month, and a full month for each month left (to March, or to the month they leave), with an earlier employer's
 * salary and TDS from their declaration; declared deductions count until the proof month, then only those with proof.
 * The month's TDS is the year's tax less what was deducted, spread over the months left with this one.
 */
export function taxWorkingFor(input: {
	employee: Pick<Employee, 'taxRegime' | 'dateOfBirth' | 'taxDeclarations' | 'leftOn'>;
	month: string;
	ytd: YearToDate;
	thisMonth: MonthFigures;
	fullMonth: MonthFigures;
	rules: IncomeTaxRules;
	regime: 'new' | 'old' | null;
}) {
	const year = financialYearOf(input.month);
	const declared = input.employee.taxDeclarations.find((d) => d.year === year) ?? null;
	const regime = input.regime ?? declared?.regime ?? input.employee.taxRegime;
	const after = monthsAfter(input.month, input.employee.leftOn);
	const proof = proofDue(input.month, input.rules.proofFromMonth);
	const counts = (rupees: number, proven: boolean) => (proof && !proven ? 0 : paise(rupees));
	const year12 = (pick: (m: MonthFigures) => number, ytd: number) =>
		ytd + pick(input.thisMonth) + pick(input.fullMonth) * after;
	const working = taxForYear(
		{
			regime,
			ageBand: ageBand(input.employee.dateOfBirth, year),
			salaryPaise: year12((m) => m.grossPaise, input.ytd.grossPaise) + paise(declared?.previousSalaryINR ?? 0),
			hraPaise: year12((m) => m.hraPaise, input.ytd.hraPaise),
			basicDaPaise: year12((m) => m.basicDaPaise, input.ytd.basicDaPaise),
			pfPaise: year12((m) => m.pfPaise, input.ytd.pfPaise),
			professionalTaxPaise: year12((m) => m.ptPaise, input.ytd.ptPaise),
			rentPaise: counts((declared?.rentMonthlyINR ?? 0) * 12, !!declared?.proof.rent),
			metro: !!declared?.metroCity,
			s80cPaise: counts(declared?.s80cINR ?? 0, !!declared?.proof.s80c),
			s80dPaise: counts(declared?.s80dINR ?? 0, !!declared?.proof.s80d),
			homeLoanInterestPaise: counts(declared?.homeLoanInterestINR ?? 0, !!declared?.proof.homeLoan),
		},
		input.rules,
	);
	const deductedBeforePaise = input.ytd.tdsPaise + paise(declared?.previousTdsINR ?? 0);
	const monthsLeft = after + 1;
	return {
		regime,
		working,
		deductedBeforePaise,
		monthsLeft,
		declarationsCount: !proof,
		monthPaise: monthlyTds(working.taxPaise, deductedBeforePaise, monthsLeft),
	};
}

/** A total split across weights, whole rupees each, the remainder on the last share that has weight. */
export function allocate(totalPaise: number, weights: readonly number[]): number[] {
	const all = weights.reduce((s, w) => s + w, 0);
	if (!all) return weights.map(() => 0);
	const out = weights.map((w) => Math.floor((totalPaise * w) / all / 100) * 100);
	const last = weights.findLastIndex((w) => w > 0);
	out[last] = (out[last] as number) + totalPaise - out.reduce((s, v) => s + v, 0);
	return out;
}

/**
 * Payroll (accounts brief S). Employees with their statutory details (Aadhaar and bank numbers sealed, shown masked
 * unless the person may lock the books, each full view logged: D29); a month's attendance locked before the run; the
 * run prepared from it with the rules in force, approved, posted as one journal per location, and paid from a bank.
 */
@Injectable()
export class PayrollService {
	constructor(
		@Inject(EMPLOYEE_REPOSITORY) private readonly employees: EmployeeRepository,
		@Inject(ATTENDANCE_REPOSITORY) private readonly attendance: AttendanceRepository,
		@Inject(PAYROLL_RUN_REPOSITORY) private readonly runs: PayrollRunRepository,
		@Inject(LedgerService)
		private readonly ledger: Pick<LedgerService, 'chart' | 'addLedger' | 'post' | 'voucherByKey'>,
		@Inject(TRANSACTION_MANAGER) private readonly transactions: TransactionManagerPort,
		@Inject(AUDIT_LOG_REPOSITORY) private readonly audit: Pick<AuditLogRepository, 'append'>,
		@Inject(PayrollRulesService) private readonly rules: Pick<PayrollRulesService, 'forMonth'>,
		@Inject(LOCATION_REPOSITORY) private readonly locations: Pick<LocationRepository, 'list'>,
	) {}

	private mayseeWhole(principal: AuthenticatedPrincipal | undefined) {
		return !!principal?.permissions.includes('accounts.lock');
	}

	private async view(list: Employee[], principal: AuthenticatedPrincipal | undefined): Promise<EmployeeView[]> {
		const whole = this.mayseeWhole(principal);
		if (whole && list.some((e) => e.aadhaar || e.bankAccount))
			await this.audit.append({
				id: `aud_${randomUUID()}`,
				// Only someone signed in with accounts.lock sees the whole numbers.
				actorUserId: (principal as AuthenticatedPrincipal).userId,
				targetUserId: null,
				audience: 'admin',
				action: 'payroll.employee.view_full',
				entityType: 'employee',
				entityId: list.length === 1 ? (list[0] as Employee).id : null,
				severity: 'info',
				retentionTier: 'financial_security',
				diffs: [],
				metadata: { count: list.length },
				requestId: null,
				ipHash: null,
				createdAt: new Date().toISOString(),
			} as never);
		return list.map((e) =>
			whole
				? { ...e, masked: false }
				: { ...e, aadhaar: mask(e.aadhaar), bankAccount: mask(e.bankAccount), masked: true },
		);
	}

	async listEmployees(principal: AuthenticatedPrincipal | undefined): Promise<EmployeeView[]> {
		return this.view(await this.employees.list(), principal);
	}

	private async employee(id: string): Promise<Employee> {
		const employee = await this.employees.get(id);
		if (!employee) throw new NotFoundException(accountsRefusal('employee_not_found'));
		return employee;
	}

	private keyed<T>(work: () => Promise<T>): Promise<T> {
		return work().catch((error: unknown) => {
			if (error instanceof Error && error.message === 'payroll_pii_key_missing')
				throw refuse('payroll_pii_key_missing');
			if (error instanceof Error && error.message === 'employee_changed')
				throw new ConflictException(accountsRefusal('employee_changed'));
			throw error;
		});
	}

	async createEmployee(write: EmployeeWrite, now = new Date()): Promise<Employee> {
		const employee: Employee = {
			...write,
			id: `emp_${randomUUID()}`,
			createdAt: now.toISOString(),
			updatedAt: now.toISOString(),
			version: 0,
		};
		await this.keyed(() => this.employees.insert(employee));
		return employee;
	}

	/** A masked number sent back unchanged keeps the stored one. */
	async updateEmployee(id: string, edit: EmployeeEdit, now = new Date()): Promise<Employee> {
		const current = await this.employee(id);
		const { version, ...write } = edit;
		const keep = (sent: string, stored: string) => (sent.startsWith('••••') ? stored : sent);
		return this.keyed(() =>
			this.employees.save(
				{
					...current,
					...write,
					aadhaar: keep(write.aadhaar, current.aadhaar),
					bankAccount: keep(write.bankAccount, current.bankAccount),
					updatedAt: now.toISOString(),
				},
				version,
			),
		);
	}

	/** Who is on the payroll in a month: joined by its end and not gone before it began. */
	private onRoll(e: Employee, month: string) {
		return e.joinedOn <= monthEnd(month) && (!e.leftOn || e.leftOn >= `${month}-01`);
	}

	/** S8: the month's attendance, or full days for everyone on the roll until it is saved. */
	async getAttendance(month: string): Promise<Attendance> {
		const saved = await this.attendance.get(month);
		if (saved) return saved;
		const days = daysIn(month);
		return {
			month,
			daysInMonth: days,
			rows: (await this.employees.list())
				.filter((e) => this.onRoll(e, month))
				.map((e) => ({ employeeId: e.id, paidDays: days, leaveTaken: 0, note: '' })),
			lockedAt: null,
			lockedBy: null,
			version: 0,
		};
	}

	async saveAttendance(
		month: string,
		write: AttendanceWrite,
		principal: AuthenticatedPrincipal | undefined,
		now = new Date(),
	) {
		const saved = await this.attendance.get(month);
		if (saved?.lockedAt) throw refuse('attendance_locked');
		if (saved && saved.version !== write.version)
			throw new ConflictException(accountsRefusal('attendance_changed'));
		const days = daysIn(month);
		if (write.rows.some((r) => r.paidDays > days)) throw refuse('attendance_days_over');
		try {
			return await this.attendance.save(
				{
					month,
					daysInMonth: days,
					rows: write.rows,
					lockedAt: write.lock ? now.toISOString() : null,
					lockedBy: write.lock ? (principal?.userId ?? null) : null,
					version: saved?.version ?? 0,
				},
				saved ? saved.version : null,
			);
		} catch (error) {
			if (error instanceof Error && error.message === 'attendance_changed')
				throw new ConflictException(accountsRefusal('attendance_changed'));
			throw error;
		}
	}

	/** TX1: one person's year worked both ways, for this month (a full month's pay, the earlier runs so far). */
	async incomeTax(employeeId: string, month: string): Promise<IncomeTaxView> {
		const e = await this.employees.get(employeeId);
		if (!e) throw new NotFoundException(accountsRefusal('employee_not_found'));
		const { pay: rules, states, incomeTax } = await this.rules.forMonth(month);
		const fyStart = `${financialYearOf(month).slice(0, 4)}-04`;
		const earlier = (await this.runs.list()).filter((r) => r.month >= fyStart && r.month < month);
		const stateOf = new Map((await this.locations.list()).map((l) => [l.id, l.stateCode]));
		const stateRules = stateRulesFor(states, stateOf.get(e.locationId) ?? e.ptState);
		const structure = {
			basic: paise(e.structure.basic),
			da: paise(e.structure.da),
			hra: paise(e.structure.hra),
			special: paise(e.structure.special),
			conveyance: paise(e.structure.conveyance),
			other: paise(e.structure.other),
		};
		const days = daysIn(month);
		const p = monthPay({
			structure,
			daysInMonth: days,
			paidDays: days,
			pfOn: e.pfOn,
			esiOn: e.esiOn,
			advanceDuePaise: 0,
			tdsPaise: 0,
			rules,
			ptFor: (gross) => (stateRules ? statePt(month, gross, stateRules) : 0),
		});
		const full: MonthFigures = {
			grossPaise: p.grossPaise,
			pfPaise: p.pfEmployeePaise,
			ptPaise: p.ptPaise,
			hraPaise: structure.hra,
			basicDaPaise: structure.basic + structure.da,
		};
		const both = (regime: 'new' | 'old') => {
			const t = taxWorkingFor({
				employee: e,
				month,
				ytd: yearToDate(earlier, e.id),
				thisMonth: full,
				fullMonth: full,
				rules: incomeTax,
				regime,
			});
			return { ...t, view: { ...t.working, monthlyPaise: t.monthPaise } };
		};
		const chosen = taxWorkingFor({
			employee: e,
			month,
			ytd: yearToDate(earlier, e.id),
			thisMonth: full,
			fullMonth: full,
			rules: incomeTax,
			regime: null,
		});
		const old = both('old');
		return {
			year: financialYearOf(month),
			regime: chosen.regime,
			ageBand: ageBand(e.dateOfBirth, financialYearOf(month)),
			declarationsCount: chosen.declarationsCount,
			old: old.view,
			new: both('new').view,
			deductedPaise: old.deductedBeforePaise,
			monthsLeft: old.monthsLeft,
		};
	}

	/** BN1: the year's bonus per covered person from its posted runs: wages, what was provided, what the Act asks. */
	async bonusYear(year: string): Promise<BonusYear> {
		const runs = (await this.runs.list()).filter(
			(r) => financialYearOf(r.month) === year && (r.status === 'posted' || r.status === 'paid'),
		);
		const { bonus } = await this.rules.forMonth(`${Number(year.slice(0, 4)) + 1}-03`);
		const people = new Map<string, BonusYearRow>();
		for (const row of runs.flatMap((r) => r.rows)) {
			const one = people.get(row.employeeId) ?? {
				employeeId: row.employeeId,
				name: row.name,
				wagesPaise: 0,
				providedPaise: 0,
				duePaise: 0,
			};
			one.wagesPaise += row.bonusWagesPaise ?? 0;
			one.providedPaise += row.bonusPaise ?? 0;
			people.set(row.employeeId, one);
		}
		const rows = [...people.values()]
			.filter((r) => r.wagesPaise > 0)
			.map((r) => ({ ...r, duePaise: bonusDue(r.wagesPaise, bonus) }));
		const paid = await this.ledger.voucherByKey(`bonusPay:${year}`);
		return {
			year,
			ratePct: bonus.ratePct,
			rows,
			providedPaise: rows.reduce((s, r) => s + r.providedPaise, 0),
			duePaise: rows.reduce((s, r) => s + r.duePaise, 0),
			paidVoucherId: paid?.id ?? null,
		};
	}

	/**
	 * BN1 Pay bonus: once a year, each covered person's bonus as the Act asks; what was provided comes off the payable,
	 * anything more is the year's bonus expense; paid from a bank at each person's last location.
	 */
	async payBonus(year: string, write: BonusPay, principal: AuthenticatedPrincipal | undefined): Promise<BonusYear> {
		const view = await this.bonusYear(year);
		if (view.paidVoucherId) throw new ConflictException(accountsRefusal('bonus_paid'));
		if (!view.rows.length) throw refuse('bonus_nothing');
		const by = principal?.userId ?? null;
		const runs = (await this.runs.list()).filter((r) => financialYearOf(r.month) === year);
		const lastAt = new Map<string, string>();
		for (const run of [...runs].sort((a, b) => a.month.localeCompare(b.month)))
			for (const row of run.rows) lastAt.set(row.employeeId, row.locationId);
		const [expense, payable] = [await this.ledgerFor('bonus', by), await this.ledgerFor('bonusPayable', by)];
		const lines = view.rows.flatMap((r) => {
			const locationId = lastAt.get(r.employeeId) as string;
			const more = r.duePaise - r.providedPaise;
			return [
				{ ledger: { id: payable }, locationId, debitPaise: Math.min(r.providedPaise, r.duePaise) },
				{ ledger: { id: expense }, locationId, debitPaise: Math.max(0, more) },
				// Provided beyond what is due (a rate lowered after months were provided) goes back.
				{ ledger: { id: payable }, locationId, debitPaise: Math.max(0, -more) },
				{ ledger: { id: expense }, locationId, creditPaise: Math.max(0, -more) },
				{ ledger: { id: write.bankLedgerId }, locationId, creditPaise: r.duePaise },
			].filter((l) => ((l.debitPaise ?? l.creditPaise) as number) > 0);
		});
		await this.transactions.withTransaction((context) =>
			this.ledger.post(
				{
					kind: 'journal',
					date: write.paidOn,
					narration: `Bonus for ${year}`,
					source: { type: 'bonus', id: year, number: null },
					idempotencyKey: `bonusPay:${year}`,
					lines,
				},
				context,
				by,
			),
		);
		return this.bonusYear(year);
	}

	listRuns(): Promise<PayrollRun[]> {
		return this.runs.list();
	}

	async getRun(month: string): Promise<PayrollRun | null> {
		return this.runs.get(month);
	}

	/** S5 Prepare: each person's pay from the locked attendance; a draft is worked out again, never one approved. */
	async prepare(month: string, now = new Date()): Promise<PayrollRun> {
		const existing = await this.runs.get(month);
		if (existing && existing.status !== 'draft') throw refuse('payroll_run_approved');
		const attendance = await this.attendance.get(month);
		if (!attendance?.lockedAt) throw refuse('payroll_attendance_not_locked');
		const people = new Map((await this.employees.list()).map((e) => [e.id, e]));
		const { pay: rules, schemes, states, incomeTax, bonus } = await this.rules.forMonth(month);
		// TX: the year so far, from the runs of the financial year before this month.
		const fyStart = `${financialYearOf(month).slice(0, 4)}-04`;
		const earlier = (await this.runs.list()).filter((r) => r.month >= fyStart && r.month < month);
		// ST2: a person's State is their work location's; one not found keeps the State saved on the person.
		const stateOf = new Map((await this.locations.list()).map((l) => [l.id, l.stateCode]));
		const missing = new Set<string>();
		const headcount = attendance.rows.filter((a) => people.has(a.employeeId)).length;
		const gratuityApplies = headcount >= schemes.gratuityHeadcount;
		// BN1: the Bonus Act applies from its headcount; covered people's bonus is provided monthly when the rules say so.
		const bonusApplies = headcount >= schemes.bonusHeadcount;
		const rows: PayrollRow[] = attendance.rows.flatMap((a) => {
			const e = people.get(a.employeeId);
			if (!e) return [];
			const structure = {
				basic: paise(e.structure.basic),
				da: paise(e.structure.da),
				hra: paise(e.structure.hra),
				special: paise(e.structure.special),
				conveyance: paise(e.structure.conveyance),
				other: paise(e.structure.other),
			};
			const stateCode = stateOf.get(e.locationId) ?? e.ptState;
			const stateRules = stateRulesFor(states, stateCode);
			if (!stateRules) missing.add(stateCode);
			const base = {
				structure,
				daysInMonth: attendance.daysInMonth,
				pfOn: e.pfOn,
				esiOn: e.esiOn,
				advanceDuePaise: Math.min(paise(e.advancePerMonthINR), paise(e.advanceDueINR)),
				rules,
				ptFor: (gross: number) => (stateRules ? statePt(month, gross, stateRules) : 0),
			};
			const figures = (paidDays: number): MonthFigures => {
				const p = monthPay({ ...base, paidDays, tdsPaise: 0 });
				const h = payslipHeads(structure, attendance.daysInMonth, paidDays, p.grossPaise);
				return {
					grossPaise: p.grossPaise,
					pfPaise: p.pfEmployeePaise,
					ptPaise: p.ptPaise,
					hraPaise: h.hra,
					basicDaPaise: h.basic + h.da,
				};
			};
			const thisMonth = figures(a.paidDays);
			const wages = bonusApplies
				? bonusWages(
						{
							basicDaPaise: thisMonth.basicDaPaise,
							fullBasicDaPaise: structure.basic + structure.da,
							paidDays: a.paidDays,
							daysInMonth: attendance.daysInMonth,
						},
						bonus,
					)
				: 0;
			const tax = taxWorkingFor({
				employee: e,
				month,
				ytd: yearToDate(earlier, e.id),
				thisMonth,
				fullMonth: figures(attendance.daysInMonth),
				rules: incomeTax,
				regime: null,
			});
			const pay = monthPay({ ...base, paidDays: a.paidDays, tdsPaise: tax.monthPaise });
			const lwf = stateRules
				? stateLwf(month, pay.grossPaise, stateRules)
				: { employeePaise: 0, employerPaise: 0 };
			return [
				{
					employeeId: e.id,
					name: e.name,
					locationId: e.locationId,
					stateCode,
					paidDays: a.paidDays,
					...pay,
					netPaise: pay.netPaise - lwf.employeePaise,
					lwfEmployeePaise: lwf.employeePaise,
					lwfEmployerPaise: lwf.employerPaise,
					gratuityPaise: gratuityProvision(structure, gratuityApplies, schemes),
					headsPaise: payslipHeads(structure, attendance.daysInMonth, a.paidDays, pay.grossPaise),
					bonusWagesPaise: wages,
					bonusPaise: bonus.provision === 'monthly' ? bonusOn(wages, bonus) : 0,
					tax: {
						regime: tax.regime,
						yearSalaryPaise: tax.working.salaryPaise,
						deductionsPaise:
							tax.working.hraExemptPaise +
							tax.working.standardDeductionPaise +
							tax.working.deductionsPaise +
							tax.working.professionalTaxPaise,
						taxablePaise: tax.working.taxablePaise,
						yearTaxPaise: tax.working.taxPaise,
						deductedBeforePaise: tax.deductedBeforePaise,
						monthsLeft: tax.monthsLeft,
					},
				},
			];
		});
		const charges = pfEstablishmentCharges(
			rows.filter((r) => r.pfEmployeePaise > 0).map((r) => Math.min(r.pfWagesPaise, rules.pfWageCapPaise)),
			schemes,
		);
		const run: PayrollRun = {
			id: existing?.id ?? `pay_${randomUUID()}`,
			month,
			status: 'draft',
			rows,
			rulesFrom: rules.from,
			schemesFrom: schemes.from,
			pfAdminPaise: charges.adminPaise,
			edliPaise: charges.edliPaise,
			statesMissing: [...missing].sort(),
			voucherId: null,
			payVoucherId: null,
			approvedBy: null,
			approvedAt: null,
			createdAt: existing?.createdAt ?? now.toISOString(),
			updatedAt: now.toISOString(),
			version: existing?.version ?? 0,
		};
		return this.save(run, existing ? existing.version : null);
	}

	private async save(run: PayrollRun, version: number | null, context?: Parameters<PayrollRunRepository['save']>[2]) {
		try {
			return await this.runs.save(run, version, context);
		} catch (error) {
			if (error instanceof Error && error.message === 'payroll_run_changed')
				throw new ConflictException(accountsRefusal('payroll_run_changed'));
			throw error;
		}
	}

	/** A payroll ledger by name in its group, made when the chart doesn't have it. */
	private async ledgerFor(which: keyof typeof PAYROLL_LEDGERS, by: string | null): Promise<string> {
		const { name, group } = PAYROLL_LEDGERS[which];
		const chart = await this.ledger.chart();
		const holder = chart.groups.find((g) => g.systemKey === group);
		if (!holder) throw refuse('books_not_set_up');
		const found = chart.ledgers.find((l) => l.groupId === holder.id && l.name === name);
		if (found) return found.id;
		return (await this.ledger.addLedger({ name, groupId: holder.id, active: true, expectedUpdatedAt: null }, by))
			.id;
	}

	/** S5: Approve (lock the books permission), Post (one journal per location), Paid (net pay from a bank). */
	async step(month: string, write: PayrollStep, principal: AuthenticatedPrincipal | undefined, now = new Date()) {
		const run = await this.runs.get(month);
		if (!run) throw new NotFoundException(accountsRefusal('payroll_run_not_found'));
		if (run.version !== write.version) throw new ConflictException(accountsRefusal('payroll_run_changed'));
		const by = principal?.userId ?? null;
		if (write.to === 'approved') {
			if (run.status !== 'draft') throw refuse('payroll_wrong_step');
			if (!principal?.permissions.includes('accounts.lock')) throw refuse('payroll_approver_only');
			// ST1: someone works in a State the rules don't cover yet; add its set, then prepare the run again.
			if (run.statesMissing?.length) throw refuse('payroll_state_rules_missing');
			return this.save(
				{
					...run,
					status: 'approved',
					approvedBy: by,
					approvedAt: now.toISOString(),
					updatedAt: now.toISOString(),
				},
				run.version,
			);
		}
		if (write.to === 'posted') {
			if (run.status !== 'approved') throw refuse('payroll_wrong_step');
			const ids = {
				salaries: await this.ledgerFor('salaries', by),
				employerPf: await this.ledgerFor('employerPf', by),
				employerEsi: await this.ledgerFor('employerEsi', by),
				salaryPayable: await this.ledgerFor('salaryPayable', by),
				pfPayable: await this.ledgerFor('pfPayable', by),
				esiPayable: await this.ledgerFor('esiPayable', by),
				ptPayable: await this.ledgerFor('ptPayable', by),
			};
			const chart = await this.ledger.chart();
			const role = (key: string) => {
				try {
					return resolveRole(chart.ledgers, key).id;
				} catch {
					throw refuse('books_not_set_up');
				}
			};
			const tds = role('tds_payable');
			const advance = role('staff_advance');
			const sum = (rows: PayrollRow[], pick: (r: PayrollRow) => number) => rows.reduce((s, r) => s + pick(r), 0);
			const lwfOf = (r: PayrollRow) => (r.lwfEmployeePaise ?? 0) + (r.lwfEmployerPaise ?? 0);
			const hasLwf = sum(run.rows, lwfOf) > 0;
			const hasGratuity = sum(run.rows, (r) => r.gratuityPaise ?? 0) > 0;
			const hasBonus = sum(run.rows, (r) => r.bonusPaise ?? 0) > 0;
			const more = {
				bonus: hasBonus ? await this.ledgerFor('bonus', by) : '',
				bonusPayable: hasBonus ? await this.ledgerFor('bonusPayable', by) : '',
				employerLwf: hasLwf ? await this.ledgerFor('employerLwf', by) : '',
				lwfPayable: hasLwf ? await this.ledgerFor('lwfPayable', by) : '',
				gratuity: hasGratuity ? await this.ledgerFor('gratuity', by) : '',
				gratuityProvision: hasGratuity ? await this.ledgerFor('gratuityProvision', by) : '',
			};
			const byLocation = new Map<string, PayrollRow[]>();
			for (const row of run.rows)
				byLocation.set(row.locationId, [...(byLocation.get(row.locationId) ?? []), row]);
			// The employer's EPF admin charges and EDLI, shared by each location's PF wages.
			const groups = [...byLocation.entries()];
			const { pay } = await this.rules.forMonth(month);
			const capped = (r: PayrollRow) =>
				r.pfEmployeePaise > 0 ? Math.min(r.pfWagesPaise, pay.pfWageCapPaise) : 0;
			const pfShare = allocate(
				(run.pfAdminPaise ?? 0) + (run.edliPaise ?? 0),
				groups.map(([, rows]) => sum(rows, capped)),
			);
			const lines = groups.flatMap(([locationId, rows], index) =>
				[
					{ ledger: { id: ids.salaries }, debitPaise: sum(rows, (r) => r.grossPaise) },
					{
						ledger: { id: ids.employerPf },
						debitPaise: sum(rows, (r) => r.pfEmployerPaise) + (pfShare[index] as number),
					},
					{ ledger: { id: ids.employerEsi }, debitPaise: sum(rows, (r) => r.esiEmployerPaise) },
					{ ledger: { id: more.employerLwf }, debitPaise: sum(rows, (r) => r.lwfEmployerPaise ?? 0) },
					{ ledger: { id: more.gratuity }, debitPaise: sum(rows, (r) => r.gratuityPaise ?? 0) },
					{ ledger: { id: more.bonus }, debitPaise: sum(rows, (r) => r.bonusPaise ?? 0) },
					{ ledger: { id: ids.salaryPayable }, creditPaise: sum(rows, (r) => r.netPaise) },
					{
						ledger: { id: ids.pfPayable },
						creditPaise:
							sum(rows, (r) => r.pfEmployeePaise + r.pfEmployerPaise) + (pfShare[index] as number),
					},
					{ ledger: { id: more.lwfPayable }, creditPaise: sum(rows, lwfOf) },
					{ ledger: { id: more.gratuityProvision }, creditPaise: sum(rows, (r) => r.gratuityPaise ?? 0) },
					{ ledger: { id: more.bonusPayable }, creditPaise: sum(rows, (r) => r.bonusPaise ?? 0) },
					{
						ledger: { id: ids.esiPayable },
						creditPaise: sum(rows, (r) => r.esiEmployeePaise + r.esiEmployerPaise),
					},
					{ ledger: { id: ids.ptPayable }, creditPaise: sum(rows, (r) => r.ptPaise) },
					{ ledger: { id: tds }, creditPaise: sum(rows, (r) => r.tdsPaise) },
					{ ledger: { id: advance }, creditPaise: sum(rows, (r) => r.advancePaise) },
				]
					// Each line is a debit or a credit: a line of nothing is left out.
					.filter((l) => ((l.debitPaise ?? l.creditPaise) as number) > 0)
					.map((l) => ({ ...l, locationId })),
			);
			return this.transactions.withTransaction(async (context) => {
				const voucher = await this.ledger.post(
					{
						kind: 'journal',
						date: monthEnd(month),
						narration: `Payroll for ${month}`,
						source: { type: 'payroll', id: run.id, number: null },
						idempotencyKey: `payroll:${month}`,
						lines,
					},
					context,
					by,
				);
				for (const row of run.rows) {
					if (!row.advancePaise) continue;
					const e = await this.employees.get(row.employeeId);
					if (e)
						await this.employees.save(
							{
								...e,
								advanceDueINR: Math.max(0, e.advanceDueINR - row.advancePaise / 100),
								updatedAt: now.toISOString(),
							},
							e.version,
							context,
						);
				}
				return this.save(
					{ ...run, status: 'posted', voucherId: voucher.id, updatedAt: now.toISOString() },
					run.version,
					context,
				);
			});
		}
		if (run.status !== 'posted') throw refuse('payroll_wrong_step');
		if (!write.bankLedgerId || !write.paidOn) throw refuse('payroll_bank_needed');
		const payable = await this.ledgerFor('salaryPayable', by);
		const total = run.rows.reduce((s, r) => s + r.netPaise, 0);
		const location = run.rows[0]?.locationId;
		if (!location) throw refuse('payroll_wrong_step');
		return this.transactions.withTransaction(async (context) => {
			const voucher = await this.ledger.post(
				{
					kind: 'payment',
					date: write.paidOn as string,
					narration: `Salaries paid for ${month}`,
					source: { type: 'payrollPay', id: run.id, number: null },
					idempotencyKey: `payrollPay:${month}`,
					lines: [
						{ ledger: { id: payable }, locationId: location, debitPaise: total },
						{ ledger: { id: write.bankLedgerId as string }, locationId: location, creditPaise: total },
					],
				},
				context,
				by,
			);
			return this.save(
				{
					...run,
					status: 'paid',
					payVoucherId: voucher.id,
					paidOn: write.paidOn,
					updatedAt: now.toISOString(),
				},
				run.version,
				context,
			);
		});
	}
}
