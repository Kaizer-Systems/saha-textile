import type {
	Attendance,
	AttendanceDay,
	Employee,
	PayrollAdvance,
	PayrollRulesVersion,
	PayrollRun,
	SalaryTemplate,
	StatutoryKind,
} from '@saha-textile/contracts';

import type { TransactionContext } from './transaction-manager.port';

/**
 * Employees (accounts brief S3). Aadhaar and the bank account are sealed at rest (decision D29); a store without its
 * key refuses to save either with `payroll_pii_key_missing`, and reads them back as empty.
 */
export interface EmployeeRepository {
	list(): Promise<Employee[]>;
	get(id: string): Promise<Employee | null>;
	insert(employee: Employee): Promise<void>;
	/** Refused with `employee_changed` when someone saved since `expectedVersion`; stored one higher. */
	save(employee: Employee, expectedVersion: number, context?: TransactionContext): Promise<Employee>;
}

/** A month's attendance (S8). */
export interface AttendanceRepository {
	get(month: string): Promise<Attendance | null>;
	/** A first save (null) or over the version read; refused with `attendance_changed`. */
	save(attendance: Attendance, expectedVersion: number | null): Promise<Attendance>;
}

/** Brief 26 AT: attendance day by day; a day is saved over the version read, refused with `attendance_day_changed`. */
export interface AttendanceDayRepository {
	get(employeeId: string, day: string): Promise<AttendanceDay | null>;
	/** The days of a month (`2026-11`), for some people or a store. */
	month(month: string, filter: { employeeIds?: readonly string[]; locationId?: string }): Promise<AttendanceDay[]>;
	/** Days waiting on an approval, for some stores (all when none named). */
	pending(locationIds: readonly string[] | null): Promise<AttendanceDay[]>;
	save(day: AttendanceDay, expectedVersion: number | null): Promise<AttendanceDay>;
}

/** Payroll runs (S5), one per month. */
export interface PayrollRunRepository {
	list(): Promise<PayrollRun[]>;
	get(month: string): Promise<PayrollRun | null>;
	/** A first save (null) or over the version read; refused with `payroll_run_changed`. */
	save(run: PayrollRun, expectedVersion: number | null, context?: TransactionContext): Promise<PayrollRun>;
}

/** Dated payroll rule versions (S1); never changed once added. */
export interface PayrollRulesRepository {
	list(): Promise<PayrollRulesVersion[]>;
	/** Refused with `payroll_rules_from_taken` when a version already starts that day. */
	insert(version: PayrollRulesVersion): Promise<void>;
}

/** Salary structure templates (S4). */
export interface SalaryTemplateRepository {
	list(): Promise<SalaryTemplate[]>;
	get(id: string): Promise<SalaryTemplate | null>;
	insert(template: SalaryTemplate): Promise<void>;
	/** Refused with `salary_template_changed` when someone saved since `expectedVersion`. */
	save(template: SalaryTemplate, expectedVersion: number): Promise<SalaryTemplate>;
}

/** S7: a statutory return marked filed, one per kind and period. */
export interface StatutoryFilingRecord {
	kind: StatutoryKind;
	period: string;
	/** Professional tax and the welfare fund: the State filed for (brief 25 ST2); absent on older filings. */
	stateCode?: string | null;
	filedOn: string;
	reference: string;
	filedBy: string | null;
	filedAt: string;
}

export interface StatutoryFilingRepository {
	list(): Promise<StatutoryFilingRecord[]>;
	/** Refused with `statutory_already_filed` when that kind and period is already marked. */
	insert(filing: StatutoryFilingRecord): Promise<void>;
}

/** S9: advances given to employees. */
export interface PayrollAdvanceRepository {
	list(employeeId?: string): Promise<PayrollAdvance[]>;
	insert(advance: PayrollAdvance, context?: TransactionContext): Promise<void>;
}
