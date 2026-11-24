import { Component, computed, effect, inject, signal, type TemplateRef } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { NgbModal, type NgbModalRef } from '@ng-bootstrap/ng-bootstrap';
import { QueryClient, injectQuery } from '@tanstack/angular-query-experimental';
import { firstValueFrom, map } from 'rxjs';

import { REPORT_KEYS, ReportsGateway } from '@core/accounts/reports.gateway';
import { AdminRolesGateway } from '@core/admin-roles/admin-roles.gateway';
import { apiProblem, downloadCsv, shortDate } from '@core/purchasing/purchasing-format';
import { NotificationService } from '@data-access/services/notification.service';
import { rupees } from '@features/accounts/ledger-helpers';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';
import {
	ACCOUNTS_PRESETS,
	PeriodPicker,
	type PeriodChoice,
	type PeriodPreset,
} from '@shared/ui/period-picker/period-picker';

import { accountsRange } from '../accounts-period';

import type {
	ReportDataset,
	ReportDefinition,
	ReportFieldType,
	ReportFilter,
	ReportSpecInput,
	ReportTable,
} from '@saha-textile/contracts';

export const REPORT_DATASETS: readonly ReportDataset[] = ['invoices', 'invoiceLines', 'ledgerLines'];
export const FILTER_OPS: readonly ReportFilter['op'][] = ['is', 'isNot', 'in', 'contains', 'gt', 'lt', 'between'];

/** A cell as the table shows it. */
export function cellText(value: string | number | null, type: ReportFieldType): string {
	if (value === null || value === '') return '—';
	if (type === 'money') return `${Number(value) < 0 ? '−' : ''}${rupees(Number(value))}`;
	if (type === 'percent') return `${value}%`;
	if (type === 'date') return shortDate(String(value));
	return String(value);
}

/** A filter's typed values: several for "in" and "between", split at commas; one otherwise. */
export function filterValues(op: ReportFilter['op'], typed: string): string[] {
	return op === 'in' || op === 'between'
		? typed
				.split(',')
				.map((v) => v.trim())
				.filter(Boolean)
		: [typed.trim()];
}

/** The table as a spreadsheet file: money in rupees, everything else as shown. */
export function tableCsv(
	table: ReportTable,
	label: (key: string) => string,
): { header: string[]; rows: (string | number | null)[][] } {
	const out = (value: string | number | null, type: ReportFieldType) =>
		value === null ? null : type === 'money' ? Number(value) / 100 : value;
	return {
		header: table.columns.map((c) => label(c.key)),
		rows: [
			...table.rows.map((row) => row.map((v, i) => out(v, (table.columns[i] as { type: ReportFieldType }).type))),
			table.totals.map((v, i) => out(v, (table.columns[i] as { type: ReportFieldType }).type)),
		],
	};
}

/**
 * The report builder (accounts brief V1, V2): pick the data and period, the columns, filters, groups, totals and sort;
 * the preview follows. Save as template keeps the choices (never the figures), who can open it and whether the period
 * moves. A saved report opens here with its choices.
 */
@Component({
	selector: 'app-report-builder-page',
	imports: [PageWrapper, TranslocoModule, FormsModule, PeriodPicker],
	templateUrl: './report-builder-page.html',
})
export class ReportBuilderPage {
	private readonly gateway = inject(ReportsGateway);
	private readonly roles = inject(AdminRolesGateway);
	private readonly route = inject(ActivatedRoute);
	private readonly router = inject(Router);
	private readonly modals = inject(NgbModal);
	private readonly transloco = inject(TranslocoService);
	private readonly notifier = inject(NotificationService);
	private readonly queries = inject(QueryClient);

	readonly datasets = REPORT_DATASETS;
	readonly ops = FILTER_OPS;
	readonly presets = ACCOUNTS_PRESETS;
	readonly cell = cellText;
	readonly id = toSignal(this.route.paramMap.pipe(map((p) => p.get('id'))), { initialValue: null });
	private readonly asked = toSignal(this.route.queryParamMap.pipe(map((p) => p.get('data'))), { initialValue: null });

	readonly dataset = signal<ReportDataset>('invoices');
	readonly columns = signal<string[]>([]);
	readonly filters = signal<ReportFilter[]>([]);
	readonly groupBy = signal<string[]>([]);
	readonly totals = signal<string[]>([]);
	readonly sort = signal<{ field: string; direction: 'asc' | 'desc' } | null>(null);
	readonly preset = signal<PeriodPreset | null>('this_month');
	readonly range = signal(accountsRange({ period: 'this_month' }));
	readonly busy = signal(false);
	private loaded = false;

	readonly catalogue = injectQuery(() => ({
		queryKey: REPORT_KEYS.catalogue,
		queryFn: () => firstValueFrom(this.gateway.catalogue()),
	}));
	readonly definition = injectQuery(() => ({
		queryKey: REPORT_KEYS.one(this.id() ?? ''),
		queryFn: () => firstValueFrom(this.gateway.one(this.id() as string)),
		enabled: !!this.id(),
	}));
	readonly fields = computed(() => this.catalogue.data()?.[this.dataset()] ?? []);
	readonly summable = computed(() => this.fields().filter((f) => f.summable && this.columns().includes(f.key)));
	readonly spec = computed<ReportSpecInput>(() => ({
		dataset: this.dataset(),
		columns: this.columns(),
		filters: this.filters().filter((f) => f.values.some((v) => v !== '')),
		groupBy: this.groupBy(),
		totals: this.totals(),
		sort: this.sort(),
	}));
	readonly preview = injectQuery(() => {
		const run = { spec: this.spec(), ...this.range(), preview: true };
		return {
			queryKey: REPORT_KEYS.run(run),
			queryFn: () => firstValueFrom(this.gateway.run(run)),
			enabled: this.columns().length > 0,
		};
	});

	// Save as template (V2).
	readonly name = signal('');
	readonly folder = signal('');
	readonly openTo = signal<'me' | 'roles' | 'all'>('me');
	readonly roleIds = signal<string[]>([]);
	readonly moving = signal(true);
	private saveModal: NgbModalRef | null = null;
	readonly roleList = injectQuery(() => ({
		queryKey: ['admin-roles'],
		queryFn: () => firstValueFrom(this.roles.list()),
		enabled: this.openTo() === 'roles',
	}));

	constructor() {
		// A new report starts on the data asked for (from the library), with its first columns.
		effect(() => {
			const fields = this.catalogue.data();
			if (!fields || this.id() || this.columns().length) return;
			const asked = this.asked();
			if (asked && (REPORT_DATASETS as readonly string[]).includes(asked))
				this.dataset.set(asked as ReportDataset);
			this.columns.set((fields[this.dataset()] ?? []).slice(0, 5).map((f) => f.key));
		});
		// A saved report opens with its choices; a moving period is worked out again for today.
		effect(() => {
			const d = this.definition.data();
			if (!d || this.loaded) return;
			this.loaded = true;
			this.open(d);
		});
	}

	open(d: ReportDefinition): void {
		this.dataset.set(d.spec.dataset);
		this.columns.set([...d.spec.columns]);
		this.filters.set(d.spec.filters.map((f) => ({ ...f, values: [...f.values] })));
		this.groupBy.set([...d.spec.groupBy]);
		this.totals.set([...d.spec.totals]);
		this.sort.set(d.spec.sort);
		this.preset.set((d.periodPreset as PeriodPreset | null) ?? null);
		this.range.set(
			d.periodPreset ? accountsRange({ period: d.periodPreset as PeriodPreset }) : { from: d.from, to: d.to },
		);
		this.name.set(d.name);
		this.folder.set(d.folder);
		this.openTo.set(d.openTo);
		this.roleIds.set([...d.roleIds]);
		this.moving.set(!!d.periodPreset);
	}

	label(key: string): string {
		return this.transloco.translate(`report_field_${key}`);
	}

	typeOf(key: string): ReportFieldType {
		return this.fields().find((f) => f.key === key)?.type ?? 'text';
	}

	setPeriod(choice: PeriodChoice): void {
		this.preset.set(choice.period === 'custom' ? null : choice.period);
		this.range.set(accountsRange(choice));
	}

	setDataset(dataset: ReportDataset): void {
		this.dataset.set(dataset);
		this.columns.set((this.catalogue.data()?.[dataset] ?? []).slice(0, 5).map((f) => f.key));
		this.filters.set([]);
		this.groupBy.set([]);
		this.totals.set([]);
		this.sort.set(null);
	}

	addColumn(key: string): void {
		if (key && !this.columns().includes(key)) this.columns.update((list) => [...list, key]);
	}

	removeColumn(key: string): void {
		this.columns.update((list) => list.filter((k) => k !== key));
		this.totals.update((list) => list.filter((k) => k !== key));
		this.groupBy.update((list) => list.filter((k) => k !== key));
		if (this.sort()?.field === key) this.sort.set(null);
	}

	addFilter(): void {
		const first = this.fields()[0];
		if (first) this.filters.update((list) => [...list, { field: first.key, op: 'is', values: [''] }]);
	}

	setFilter(index: number, patch: Partial<ReportFilter>): void {
		this.filters.update((list) => list.map((f, i) => (i === index ? { ...f, ...patch } : f)));
	}

	removeFilter(index: number): void {
		this.filters.update((list) => list.filter((_, i) => i !== index));
	}

	typed(index: number, text: string): void {
		const filter = this.filters()[index];
		if (filter) this.setFilter(index, { values: filterValues(filter.op, text) });
	}

	/** Group by up to three fields, in order; an empty choice ends the list there. */
	setGroup(index: number, key: string): void {
		this.groupBy.update((list) => (key ? [...list.slice(0, index), key] : list.slice(0, index)));
	}

	toggleTotal(key: string): void {
		this.totals.update((list) => (list.includes(key) ? list.filter((k) => k !== key) : [...list, key]));
	}

	setSort(field: string, direction: 'asc' | 'desc'): void {
		this.sort.set(field ? { field, direction } : null);
	}

	toggleRole(id: string): void {
		this.roleIds.update((list) => (list.includes(id) ? list.filter((r) => r !== id) : [...list, id]));
	}

	openSave(template: TemplateRef<unknown>): void {
		if (!this.folder()) this.folder.set(this.transloco.translate('report_folder_default'));
		this.saveModal = this.modals.open(template, { centered: true });
	}

	async save(): Promise<void> {
		const write = {
			name: this.name().trim(),
			folder: this.folder().trim(),
			spec: this.spec(),
			periodPreset: this.moving() ? this.preset() : null,
			...this.range(),
			openTo: this.openTo(),
			roleIds: this.openTo() === 'roles' ? this.roleIds() : [],
		};
		this.busy.set(true);
		try {
			const id = this.id();
			const saved = id
				? await firstValueFrom(
						this.gateway.update(id, { ...write, version: this.definition.data()?.version ?? 0 }),
					)
				: await firstValueFrom(this.gateway.create(write));
			await this.queries.invalidateQueries({ queryKey: REPORT_KEYS.all });
			this.notifier.showSuccess(this.transloco.translate('report_saved'));
			this.saveModal?.close();
			if (!id) void this.router.navigate(['/accounts/reports/saved', saved.id]);
		} catch (error) {
			this.notifier.showError(
				this.transloco.translate(`report_problem_${apiProblem(error, 'failed').split(':')[0]}`),
			);
		} finally {
			this.busy.set(false);
		}
	}

	async remove(): Promise<void> {
		const id = this.id();
		if (!id) return;
		this.busy.set(true);
		try {
			await firstValueFrom(this.gateway.remove(id));
			await this.queries.invalidateQueries({ queryKey: REPORT_KEYS.all });
			this.notifier.showSuccess(this.transloco.translate('report_deleted'));
			void this.router.navigate(['/accounts/reports']);
		} catch (error) {
			this.notifier.showError(
				this.transloco.translate(`report_problem_${apiProblem(error, 'failed').split(':')[0]}`),
			);
		} finally {
			this.busy.set(false);
		}
	}

	/** Runs the whole report (up to 5,000 rows) and saves it as a spreadsheet file. */
	async download(): Promise<void> {
		this.busy.set(true);
		try {
			const table = await firstValueFrom(
				this.gateway.run({ spec: this.spec(), ...this.range(), preview: false }),
			);
			const { header, rows } = tableCsv(table, (key) => this.label(key));
			downloadCsv(`${this.name() || 'report'}_${this.range().from}_${this.range().to}.csv`, header, rows);
		} catch (error) {
			this.notifier.showError(
				this.transloco.translate(`report_problem_${apiProblem(error, 'failed').split(':')[0]}`),
			);
		} finally {
			this.busy.set(false);
		}
	}
}
