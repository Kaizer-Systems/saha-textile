import type { Attendance, Employee, PayrollRun } from '@saha-textile/contracts';

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
