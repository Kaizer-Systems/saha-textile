import { Component, inject, signal, type TemplateRef } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { NgbModal, type NgbModalRef } from '@ng-bootstrap/ng-bootstrap';
import { QueryClient, injectQuery } from '@tanstack/angular-query-experimental';
import { firstValueFrom } from 'rxjs';

import { PAYROLL_KEYS, PayrollGateway } from '@core/accounts/payroll.gateway';
import { LOCATION_KEYS, LocationsGateway } from '@core/locations/locations.gateway';
import { apiProblem, shortDate } from '@core/purchasing/purchasing-format';
import { NotificationService } from '@data-access/services/notification.service';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';
import { HasPermissionDirective } from '@shared/directives/has-permission.directive';

import type { EmployeeView, EmployeeWriteInput, SalaryStructureWrite } from '@saha-textile/contracts';

export const STRUCTURE_HEADS = ['basic', 'da', 'hra', 'special', 'conveyance', 'other'] as const;

/** A structure's monthly total, and whether basic and DA reach half of it (the Labour Codes' wage rule, S4). */
export function structureCheck(s: SalaryStructureWrite): { total: number; basicShare: number; meetsHalf: boolean } {
	const total = STRUCTURE_HEADS.reduce((sum, head) => sum + (s[head] ?? 0), 0);
	const basicShare = total ? Math.round(((s.basic + s.da) / total) * 1000) / 10 : 0;
	return { total, basicShare, meetsHalf: !total || s.basic + s.da >= total / 2 };
}

const istToday = (): string => new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);
const blank = (): EmployeeWriteInput => ({
	name: '',
	code: '',
	locationId: '',
	joinedOn: istToday(),
	pan: '',
	aadhaar: '',
	uan: '',
	esiNumber: '',
	ptState: '19',
	taxRegime: 'new',
	bankAccount: '',
	ifsc: '',
	pfOn: true,
	esiOn: true,
	structure: { basic: 0, da: 0, hra: 0, special: 0, conveyance: 0, other: 0 },
	advanceDueINR: 0,
	advancePerMonthINR: 0,
});

/** The editable fields of an employee, as the form holds them. */
export function employeeWrite(e: EmployeeView): EmployeeWriteInput {
	return {
		name: e.name,
		code: e.code,
		userId: e.userId,
		locationId: e.locationId,
		joinedOn: e.joinedOn,
		leftOn: e.leftOn,
		pan: e.pan,
		aadhaar: e.aadhaar,
		uan: e.uan,
		esiNumber: e.esiNumber,
		ptState: e.ptState,
		taxRegime: e.taxRegime,
		bankAccount: e.bankAccount,
		ifsc: e.ifsc,
		pfOn: e.pfOn,
		esiOn: e.esiOn,
		structure: { ...e.structure },
		advanceDueINR: e.advanceDueINR,
		advancePerMonthINR: e.advancePerMonthINR,
	};
}

/**
 * Employees (accounts brief S3, S4): each person's statutory details and salary structure, with the half-the-pay wage
 * rule checked; Aadhaar and bank numbers come back masked unless the person may lock the books.
 */
@Component({
	selector: 'app-employees-page',
	imports: [PageWrapper, TranslocoModule, FormsModule, HasPermissionDirective],
	templateUrl: './employees-page.html',
})
export class EmployeesPage {
	private readonly gateway = inject(PayrollGateway);
	private readonly locationsGateway = inject(LocationsGateway);
	private readonly modals = inject(NgbModal);
	private readonly transloco = inject(TranslocoService);
	private readonly notifier = inject(NotificationService);
	private readonly queries = inject(QueryClient);

	readonly heads = STRUCTURE_HEADS;
	readonly check = structureCheck;
	readonly employees = injectQuery(() => ({
		queryKey: PAYROLL_KEYS.employees,
		queryFn: () => firstValueFrom(this.gateway.employees()),
	}));
	readonly locations = injectQuery(() => ({
		queryKey: LOCATION_KEYS.list,
		queryFn: () => firstValueFrom(this.locationsGateway.list()),
	}));
	readonly editing = signal<EmployeeView | null>(null);
	readonly form = signal<EmployeeWriteInput>(blank());
	readonly busy = signal(false);
	private modal: NgbModalRef | null = null;

	day(date: string): string {
		return shortDate(date);
	}

	locationName(id: string): string {
		return this.locations.data()?.find((l) => l.id === id)?.name ?? '';
	}

	open(template: TemplateRef<unknown>, employee: EmployeeView | null): void {
		this.editing.set(employee);
		if (employee) {
			this.form.set(employeeWrite(employee));
		} else this.form.set({ ...blank(), locationId: this.locations.data()?.find((l) => l.active)?.id ?? '' });
		this.modal = this.modals.open(template, { centered: true, size: 'lg' });
	}

	patch(fields: Partial<EmployeeWriteInput>): void {
		this.form.update((f) => ({ ...f, ...fields }));
	}

	patchStructure(head: (typeof STRUCTURE_HEADS)[number], value: number): void {
		this.form.update((f) => ({ ...f, structure: { ...f.structure, [head]: value } }));
	}

	async save(): Promise<void> {
		this.busy.set(true);
		try {
			const editing = this.editing();
			if (editing)
				await firstValueFrom(
					this.gateway.updateEmployee(editing.id, { ...this.form(), version: editing.version }),
				);
			else await firstValueFrom(this.gateway.createEmployee(this.form()));
			this.notifier.showSuccess(this.transloco.translate('payroll_employee_saved'));
			await this.queries.invalidateQueries({ queryKey: PAYROLL_KEYS.all });
			this.modal?.close();
		} catch (error) {
			this.notifier.showError(this.transloco.translate(`payroll_problem_${apiProblem(error, 'failed')}`));
		} finally {
			this.busy.set(false);
		}
	}
}
