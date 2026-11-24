import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';

import { runtimeConfig } from '@core/config/runtime-config';

import type {
	Attendance,
	AttendanceWrite,
	EmployeeView,
	EmployeeWriteInput,
	PayrollRun,
	PayrollStep,
} from '@saha-textile/contracts';
import type { Observable } from 'rxjs';

export const PAYROLL_KEYS = {
	all: ['payroll'] as const,
	employees: ['payroll', 'employees'] as const,
	attendance: (month: string) => ['payroll', 'attendance', month] as const,
	runs: ['payroll', 'runs'] as const,
	run: (month: string) => ['payroll', 'run', month] as const,
};

/** Payroll (accounts brief S). */
@Injectable({ providedIn: 'root' })
export class PayrollGateway {
	private readonly http = inject(HttpClient);
	private readonly api = (path: string) => `${runtimeConfig.apiUrl}/admin/payroll/${path}`;

	employees(): Observable<EmployeeView[]> {
		return this.http.get<EmployeeView[]>(this.api('employees'));
	}

	createEmployee(write: EmployeeWriteInput): Observable<EmployeeView> {
		return this.http.post<EmployeeView>(this.api('employees'), write);
	}

	updateEmployee(id: string, write: EmployeeWriteInput & { version: number }): Observable<EmployeeView> {
		return this.http.put<EmployeeView>(this.api(`employees/${encodeURIComponent(id)}`), write);
	}

	attendance(month: string): Observable<Attendance> {
		return this.http.get<Attendance>(this.api(`attendance/${month}`));
	}

	saveAttendance(month: string, write: AttendanceWrite): Observable<Attendance> {
		return this.http.put<Attendance>(this.api(`attendance/${month}`), write);
	}

	runs(): Observable<PayrollRun[]> {
		return this.http.get<PayrollRun[]>(this.api('runs'));
	}

	run(month: string): Observable<PayrollRun | null> {
		return this.http.get<PayrollRun | null>(this.api(`runs/${month}`));
	}

	prepare(month: string): Observable<PayrollRun> {
		return this.http.post<PayrollRun>(this.api(`runs/${month}`), {});
	}

	step(
		month: string,
		write: Partial<PayrollStep> & { to: PayrollStep['to']; version: number },
	): Observable<PayrollRun> {
		return this.http.post<PayrollRun>(this.api(`runs/${month}/step`), write);
	}
}
