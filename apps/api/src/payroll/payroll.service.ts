import { randomUUID } from 'node:crypto';

import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type {
	Attendance,
	AttendanceWrite,
	Employee,
	EmployeeEdit,
	EmployeeView,
	EmployeeWrite,
	PayrollRow,
	PayrollRun,
	PayrollStep,
} from '@saha-textile/contracts';
import {
	PAYROLL_RULES_2026,
	monthPay,
	monthlyTds,
	newRegimeTax,
	resolveRole,
	type AttendanceRepository,
	type AuditLogRepository,
	type EmployeeRepository,
	type PayrollRunRepository,
	type TransactionManagerPort,
} from '@saha-textile/core-domain';

import type { AuthenticatedPrincipal } from '../auth/session.guard';
import {
	ATTENDANCE_REPOSITORY,
	AUDIT_LOG_REPOSITORY,
	EMPLOYEE_REPOSITORY,
	PAYROLL_RUN_REPOSITORY,
	TRANSACTION_MANAGER,
} from '../infra/tokens';
import { accountsRefusal } from '../ledger/accounts-refusal';
import { LedgerService } from '../ledger/ledger.service';

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
} as const;

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
		@Inject(LedgerService) private readonly ledger: Pick<LedgerService, 'chart' | 'addLedger' | 'post'>,
		@Inject(TRANSACTION_MANAGER) private readonly transactions: TransactionManagerPort,
		@Inject(AUDIT_LOG_REPOSITORY) private readonly audit: Pick<AuditLogRepository, 'append'>,
	) {}

	private mayseeWhole(principal: AuthenticatedPrincipal | undefined) {
		return !!principal?.permissions.includes('accounts.lock');
	}

	private async view(list: Employee[], principal: AuthenticatedPrincipal | undefined): Promise<EmployeeView[]> {
		const whole = this.mayseeWhole(principal);
		if (whole && list.some((e) => e.aadhaar || e.bankAccount))
			await this.audit.append({
				id: `aud_${randomUUID()}`,
				actorUserId: principal?.userId ?? null,
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
		const rules = PAYROLL_RULES_2026;
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
			const yearly = Object.values(structure).reduce((s, v) => s + v, 0) * 12;
			const tds = e.taxRegime === 'new' ? monthlyTds(newRegimeTax(yearly), 0, 12) : 0;
			const pay = monthPay({
				structure,
				daysInMonth: attendance.daysInMonth,
				paidDays: a.paidDays,
				pfOn: e.pfOn,
				esiOn: e.esiOn,
				advanceDuePaise: Math.min(paise(e.advancePerMonthINR), paise(e.advanceDueINR)),
				tdsPaise: tds,
				rules,
			});
			return [{ employeeId: e.id, name: e.name, locationId: e.locationId, paidDays: a.paidDays, ...pay }];
		});
		const run: PayrollRun = {
			id: existing?.id ?? `pay_${randomUUID()}`,
			month,
			status: 'draft',
			rows,
			rulesFrom: rules.from,
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
			const byLocation = new Map<string, PayrollRow[]>();
			for (const row of run.rows)
				byLocation.set(row.locationId, [...(byLocation.get(row.locationId) ?? []), row]);
			const sum = (rows: PayrollRow[], pick: (r: PayrollRow) => number) => rows.reduce((s, r) => s + pick(r), 0);
			const lines = [...byLocation.entries()].flatMap(([locationId, rows]) =>
				[
					{ ledger: { id: ids.salaries }, debitPaise: sum(rows, (r) => r.grossPaise) },
					{ ledger: { id: ids.employerPf }, debitPaise: sum(rows, (r) => r.pfEmployerPaise) },
					{ ledger: { id: ids.employerEsi }, debitPaise: sum(rows, (r) => r.esiEmployerPaise) },
					{ ledger: { id: ids.salaryPayable }, creditPaise: sum(rows, (r) => r.netPaise) },
					{
						ledger: { id: ids.pfPayable },
						creditPaise: sum(rows, (r) => r.pfEmployeePaise + r.pfEmployerPaise),
					},
					{
						ledger: { id: ids.esiPayable },
						creditPaise: sum(rows, (r) => r.esiEmployeePaise + r.esiEmployerPaise),
					},
					{ ledger: { id: ids.ptPayable }, creditPaise: sum(rows, (r) => r.ptPaise) },
					{ ledger: { id: tds }, creditPaise: sum(rows, (r) => r.tdsPaise) },
					{ ledger: { id: advance }, creditPaise: sum(rows, (r) => r.advancePaise) },
				]
					.filter(
						(l) =>
							((l as { debitPaise?: number }).debitPaise ??
								(l as { creditPaise?: number }).creditPaise ??
								0) > 0,
					)
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
				{ ...run, status: 'paid', payVoucherId: voucher.id, updatedAt: now.toISOString() },
				run.version,
				context,
			);
		});
	}
}
