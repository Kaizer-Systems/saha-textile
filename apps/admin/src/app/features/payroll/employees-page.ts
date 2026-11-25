import { Component, computed, inject, signal, type TemplateRef } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { NgbModal, type NgbModalRef } from '@ng-bootstrap/ng-bootstrap';
import { QueryClient, injectQuery } from '@tanstack/angular-query-experimental';
import { firstValueFrom } from 'rxjs';

import { PAYROLL_KEYS, PayrollGateway } from '@core/accounts/payroll.gateway';
import { LOCATION_KEYS, LocationsGateway } from '@core/locations/locations.gateway';
import { apiProblem, shortDate } from '@core/purchasing/purchasing-format';
import { NotificationService } from '@data-access/services/notification.service';
import { rupees } from '@features/accounts/ledger-helpers';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';
import { HasPermissionDirective } from '@shared/directives/has-permission.directive';

import { currentMonth } from './attendance-page';

import type {
	EmployeeView,
	EmployeeWriteInput,
	IncomeTaxView,
	SalaryStructureWrite,
	TaxDeclaration,
} from '@saha-textile/contracts';

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
	designation: '',
	department: '',
	locationId: '',
	joinedOn: istToday(),
	pan: '',
	aadhaar: '',
	uan: '',
	esiNumber: '',
	ptState: '19',
	taxRegime: 'new',
	dateOfBirth: null,
	taxDeclarations: [],
	bankAccount: '',
	ifsc: '',
	pfOn: true,
	esiOn: true,
	structure: { basic: 0, da: 0, hra: 0, special: 0, conveyance: 0, other: 0 },
	advanceDueINR: 0,
	advancePerMonthINR: 0,
});

/** The financial year a month falls in: `2027-01` → `2026-27`. */
export function yearOf(month: string): string {
	const y = Number(month.slice(0, 4));
	const start = Number(month.slice(5, 7)) >= 4 ? y : y - 1;
	return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

/** A year's declaration as a new one starts: nothing declared, the regime the person is on. */
export function newDeclaration(year: string, regime: 'new' | 'old'): TaxDeclaration {
	return {
		year,
		regime,
		chosenOn: null,
		rentMonthlyINR: 0,
		metroCity: false,
		s80cINR: 0,
		s80dINR: 0,
		homeLoanInterestINR: 0,
		previousSalaryINR: 0,
		previousTdsINR: 0,
		proof: { rent: false, s80c: false, s80d: false, homeLoan: false },
	};
}

/** TX1's comparison rows: each line of the working, old and new side by side. */
export const TAX_ROWS = [
	'salaryPaise',
	'hraExemptPaise',
	'standardDeductionPaise',
	'deductionsPaise',
	'professionalTaxPaise',
	'taxablePaise',
	'slabTaxPaise',
	'rebatePaise',
	'surchargePaise',
	'cessPaise',
	'taxPaise',
	'monthlyPaise',
] as const;

/** The editable fields of an employee, as the form holds them. */
export function employeeWrite(e: EmployeeView): EmployeeWriteInput {
	return {
		name: e.name,
		code: e.code,
		designation: e.designation,
		department: e.department,
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
		dateOfBirth: e.dateOfBirth,
		taxDeclarations: e.taxDeclarations.map((d) => ({ ...d, proof: { ...d.proof } })),
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
	readonly schemes = injectQuery(() => ({
		queryKey: PAYROLL_KEYS.schemes(currentMonth()),
		queryFn: () => firstValueFrom(this.gateway.schemes(currentMonth())),
	}));
	readonly templates = injectQuery(() => ({
		queryKey: PAYROLL_KEYS.structures,
		queryFn: () => firstValueFrom(this.gateway.structures()),
	}));
	readonly templateId = signal('');
	readonly templatePay = signal(0);
	readonly editing = signal<EmployeeView | null>(null);
	/** TX1: this financial year, its declaration in the form, and the saved year worked both ways. */
	readonly taxYear = yearOf(currentMonth());
	readonly taxRows = TAX_ROWS;
	readonly declaration = computed(() => this.form().taxDeclarations?.find((d) => d.year === this.taxYear) ?? null);
	readonly taxView = signal<IncomeTaxView | null>(null);
	readonly money = rupees;
	/** The old regime's declarations after rent: what each is called, its amount field and its proof. */
	readonly declared = [
		{ key: 's80c', field: 's80cINR', proof: 's80c' },
		{ key: 's80d', field: 's80dINR', proof: 's80d' },
		{ key: 'home_loan', field: 'homeLoanInterestINR', proof: 'homeLoan' },
		{ key: 'previous_salary', field: 'previousSalaryINR', proof: null },
		{ key: 'previous_tds', field: 'previousTdsINR', proof: null },
	] as const;

	amount(field: (typeof this.declared)[number]['field']): number {
		return this.declaration()?.[field] ?? 0;
	}

	setAmount(field: (typeof this.declared)[number]['field'], value: number): void {
		this.setDeclaration({ [field]: Math.max(0, Number(value) || 0) });
	}

	proven(key: keyof TaxDeclaration['proof']): boolean {
		return !!this.declaration()?.proof[key];
	}
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
		this.taxView.set(null);
		if (employee) {
			this.form.set(employeeWrite(employee));
		} else this.form.set({ ...blank(), locationId: this.locations.data()?.find((l) => l.active)?.id ?? '' });
		this.modal = this.modals.open(template, { centered: true, size: 'lg' });
	}

	/** Change this year's declaration, starting one from the person's regime when there is none. */
	setDeclaration(fields: Partial<TaxDeclaration>): void {
		this.form.update((f) => {
			const all = f.taxDeclarations ?? [];
			const now = all.find((d) => d.year === this.taxYear) ?? newDeclaration(this.taxYear, f.taxRegime ?? 'new');
			const next = { ...now, ...fields };
			return {
				...f,
				taxRegime: next.regime,
				taxDeclarations: [...all.filter((d) => d.year !== this.taxYear), next],
			};
		});
	}

	setProof(key: keyof TaxDeclaration['proof'], value: boolean): void {
		const p = this.declaration()?.proof;
		const proof = { rent: !!p?.rent, s80c: !!p?.s80c, s80d: !!p?.s80d, homeLoan: !!p?.homeLoan };
		this.setDeclaration({ proof: { ...proof, [key]: value } });
	}

	async workOut(): Promise<void> {
		const editing = this.editing();
		if (!editing) return;
		try {
			this.taxView.set(await firstValueFrom(this.gateway.incomeTax(editing.id, currentMonth())));
		} catch (error) {
			this.notifier.showError(this.transloco.translate(`payroll_problem_${apiProblem(error, 'failed')}`));
		}
	}

	patch(fields: Partial<EmployeeWriteInput>): void {
		this.form.update((f) => ({ ...f, ...fields }));
	}

	patchStructure(head: (typeof STRUCTURE_HEADS)[number], value: number): void {
		this.form.update((f) => ({ ...f, structure: { ...f.structure, [head]: value } }));
	}

	/** S4: fill the structure from a template on the pay typed. */
	async applyTemplate(): Promise<void> {
		const template = this.templates.data()?.find((t) => t.id === this.templateId());
		if (!template) return;
		try {
			const preview = await firstValueFrom(
				this.gateway.previewStructure({ components: template.components, payINR: this.templatePay() }),
			);
			this.form.update((f) => ({ ...f, structure: { ...f.structure, ...preview.structure } }));
		} catch (error) {
			this.notifier.showError(this.transloco.translate(`payroll_problem_${apiProblem(error, 'failed')}`));
		}
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
