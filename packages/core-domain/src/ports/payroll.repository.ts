import type {
	Attendance,
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
