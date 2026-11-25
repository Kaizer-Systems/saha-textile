import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';

import { runtimeConfig } from '@core/config/runtime-config';

import type {
	AdvanceGive,
	AdvanceSchedule,
	Attendance,
	AttendanceWrite,
	BonusPay,
	BonusYear,
	EmployeeView,
	EmployeeWriteInput,
	IncomeTaxView,
	IncrementPlan,
	IncrementPlanWriteInput,
	IncrementRowPreview,
	IncrementRowResult,
	IncrementRowsInputValue,
	PayrollRulesVersion,
	PayrollRulesWriteInput,
	PayrollRun,
	PayrollStep,
	PayslipEditsInputValue,
	Payslip,
	SalaryRevisionInputValue,
	SalaryRevisionPreview,
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
	bonus: (year: string) => ['payroll', 'bonus', year] as const,
	incrementPlans: ['payroll', 'increment-plans'] as const,
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

	/** Brief 26 PE2: a draft payslip's edits saved; the run comes back worked out again. */
	editPayslip(month: string, employeeId: string, edits: PayslipEditsInputValue): Observable<PayrollRun> {
		return this.http.put<PayrollRun>(this.api(`runs/${month}/rows/${encodeURIComponent(employeeId)}/edits`), edits);
	}

	/** Brief 26 PE4: a published run's edited figures kept as the salary from next month. */
	keepFigures(
		month: string,
		employeeIds: string[],
	): Observable<{ employeeId: string; ok: boolean; problem: string | null }[]> {
		return this.http.post<{ employeeId: string; ok: boolean; problem: string | null }[]>(
			this.api(`runs/${month}/keep-figures`),
			{ employeeIds },
		);
	}

	/** Brief 26 SR3: increment plans saved by name, and a cycle's rows worked out and accepted. */
	incrementPlans(): Observable<IncrementPlan[]> {
		return this.http.get<IncrementPlan[]>(this.api('increment-plans'));
	}

	saveIncrementPlan(write: IncrementPlanWriteInput): Observable<IncrementPlan> {
		return this.http.put<IncrementPlan>(this.api('increment-plans'), write);
	}

	deleteIncrementPlan(id: string): Observable<void> {
		return this.http.delete<void>(this.api(`increment-plans/${encodeURIComponent(id)}`));
	}

	incrementsPreview(input: IncrementRowsInputValue): Observable<IncrementRowPreview[]> {
		return this.http.post<IncrementRowPreview[]>(this.api('increments/preview'), input);
	}

	acceptIncrements(input: IncrementRowsInputValue): Observable<IncrementRowResult[]> {
		return this.http.post<IncrementRowResult[]>(this.api('increments/accept'), input);
	}

	/** Brief 26 SR2: a revision worked out, and accepted. */
	revisionPreview(employeeId: string, input: SalaryRevisionInputValue): Observable<SalaryRevisionPreview> {
		return this.http.post<SalaryRevisionPreview>(
			this.api(`employees/${encodeURIComponent(employeeId)}/revision/preview`),
			input,
		);
	}

	reviseSalary(employeeId: string, input: SalaryRevisionInputValue): Observable<EmployeeView> {
		return this.http.post<EmployeeView>(this.api(`employees/${encodeURIComponent(employeeId)}/revision`), input);
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

	/** PS4: a run's payslips (or one person's) on the active payslip format. */
	payslipsPdf(month: string, employeeId: string | null = null): Observable<Blob> {
		return this.http.get(this.api(`runs/${month}/payslips.pdf`), {
			responseType: 'blob',
			params: employeeId ? { employeeId } : {},
		});
	}

	/** BN1: the year's statutory bonus per person (Payroll › Payroll runs). */
	bonusYear(year: string): Observable<BonusYear> {
		return this.http.get<BonusYear>(this.api(`bonus/${year}`));
	}

	payBonus(year: string, write: BonusPay): Observable<BonusYear> {
		return this.http.post<BonusYear>(this.api(`bonus/${year}/pay`), write);
	}

	/** TX1: an employee's year of income tax worked both ways, as saved. */
	incomeTax(employeeId: string, month: string): Observable<IncomeTaxView> {
		return this.http.get<IncomeTaxView>(
			this.api(`employees/${encodeURIComponent(employeeId)}/income-tax/${month}`),
		);
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

	/** Professional tax and the welfare fund are one file per State (`state`, a GST State code). */
	statutoryFile(kind: StatutoryKind, period: string, state: string | null = null): Observable<StatutoryFile> {
		return this.http.get<StatutoryFile>(this.api(`statutory/${kind}/${period}/file`), {
			params: state ? { state } : {},
		});
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
