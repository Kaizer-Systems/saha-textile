import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';

import { runtimeConfig } from '@core/config/runtime-config';

import type {
	AdvanceGive,
	AdvanceSchedule,
	Attendance,
	AttendanceWrite,
	EmployeeView,
	EmployeeWriteInput,
	PayrollRulesVersion,
	PayrollRulesWriteInput,
	PayrollRun,
	PayrollStep,
	Payslip,
	SalaryTemplate,
	SalaryTemplateWriteInput,
	SchemeLine,
	StatutoryFile,
	StatutoryFiling,
	StatutoryKind,
	StatutoryReturn,
	StructurePreview,
	StructurePreviewInputValue,
} from '@saha-textile/contracts';
import type { Observable } from 'rxjs';

export const PAYROLL_KEYS = {
	all: ['payroll'] as const,
	employees: ['payroll', 'employees'] as const,
	attendance: (month: string) => ['payroll', 'attendance', month] as const,
	runs: ['payroll', 'runs'] as const,
	run: (month: string) => ['payroll', 'run', month] as const,
	rules: ['payroll', 'rules'] as const,
	schemes: (month: string) => ['payroll', 'schemes', month] as const,
	structures: ['payroll', 'structures'] as const,
	payslip: (month: string, employeeId: string) => ['payroll', 'payslip', month, employeeId] as const,
	statutory: ['payroll', 'statutory'] as const,
	advances: ['payroll', 'advances'] as const,
	advance: (employeeId: string) => ['payroll', 'advance', employeeId] as const,
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

	rules(): Observable<PayrollRulesVersion[]> {
		return this.http.get<PayrollRulesVersion[]>(this.api('rules'));
	}

	addRules(write: PayrollRulesWriteInput): Observable<PayrollRulesVersion> {
		return this.http.post<PayrollRulesVersion>(this.api('rules'), write);
	}

	schemes(month: string): Observable<SchemeLine[]> {
		return this.http.get<SchemeLine[]>(this.api(`schemes/${month}`));
	}

	structures(): Observable<SalaryTemplate[]> {
		return this.http.get<SalaryTemplate[]>(this.api('structures'));
	}

	previewStructure(input: StructurePreviewInputValue): Observable<StructurePreview> {
		return this.http.post<StructurePreview>(this.api('structures/preview'), input);
	}

	createStructure(write: SalaryTemplateWriteInput): Observable<SalaryTemplate> {
		return this.http.post<SalaryTemplate>(this.api('structures'), write);
	}

	updateStructure(id: string, write: SalaryTemplateWriteInput & { version: number }): Observable<SalaryTemplate> {
		return this.http.put<SalaryTemplate>(this.api(`structures/${encodeURIComponent(id)}`), write);
	}

	payslip(month: string, employeeId: string): Observable<Payslip> {
		return this.http.get<Payslip>(this.api(`runs/${month}/payslips/${encodeURIComponent(employeeId)}`));
	}

	statutory(): Observable<StatutoryReturn[]> {
		return this.http.get<StatutoryReturn[]>(this.api('statutory'));
	}

	statutoryFile(kind: StatutoryKind, period: string): Observable<StatutoryFile> {
		return this.http.get<StatutoryFile>(this.api(`statutory/${kind}/${period}/file`));
	}

	markFiled(kind: StatutoryKind, period: string, write: StatutoryFiling): Observable<StatutoryReturn> {
		return this.http.post<StatutoryReturn>(this.api(`statutory/${kind}/${period}/filed`), write);
	}

	advances(): Observable<AdvanceSchedule[]> {
		return this.http.get<AdvanceSchedule[]>(this.api('advances'));
	}

	advance(employeeId: string): Observable<AdvanceSchedule> {
		return this.http.get<AdvanceSchedule>(this.api(`advances/${encodeURIComponent(employeeId)}`));
	}

	giveAdvance(employeeId: string, write: Omit<AdvanceGive, 'note'> & { note?: string }): Observable<AdvanceSchedule> {
		return this.http.post<AdvanceSchedule>(this.api(`advances/${encodeURIComponent(employeeId)}`), write);
	}
}
