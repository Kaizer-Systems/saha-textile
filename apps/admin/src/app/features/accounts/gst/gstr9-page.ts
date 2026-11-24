import { Component, computed, effect, inject, signal, type TemplateRef } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { NgbModal, type NgbModalRef } from '@ng-bootstrap/ng-bootstrap';
import { QueryClient, injectQuery } from '@tanstack/angular-query-experimental';
import { firstValueFrom, map } from 'rxjs';

import { GST_KEYS, GstReturnsGateway } from '@core/accounts/gst-returns.gateway';
import { COMPANY_KEYS, CompanyGateway } from '@core/company/company.gateway';
import { downloadCsv } from '@core/purchasing/purchasing-format';
import { NotificationService } from '@data-access/services/notification.service';
import { rupees } from '@features/accounts/ledger-helpers';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';
import { HasPermissionDirective } from '@shared/directives/has-permission.directive';

import { gstProblem } from './gst-returns-page';

import type { GstAnnual, GstAnnualRow, GstMonthCheck } from '@saha-textile/contracts';

/** The financial year a day falls in, `2026-11-24` → `2026-27`. */
export function yearOf(day: string): string {
	const y = Number(day.slice(0, 4));
	const start = Number(day.slice(5, 7)) >= 4 ? y : y - 1;
	return `${start}-${String(start + 1).slice(2)}`;
}

/** The annual return is for a year gone by: the last year and the two before it. */
export function pastYears(today: string): string[] {
	const start = Number(yearOf(today).slice(0, 4));
	return [1, 2, 3].map((back) => `${start - back}-${String(start - back + 1).slice(2)}`);
}

/** A figure as G9 shows it: rupees, or a count of codes. */
export function figure(row: Pick<GstAnnualRow, 'unit'>, value: number): string {
	return row.unit === 'count' ? String(value) : rupees(value);
}

/** A month's returns agree with the books when every filed figure is within ₹1 of them. */
export function monthAgrees(m: GstMonthCheck): boolean {
	const near = (a: number | null, b: number) => a === null || Math.abs(a - b) <= 100;
	return near(m.gstr1Tax, m.booksTax) && near(m.gstr3bTax, m.booksTax) && near(m.gstr3bCredit, m.booksCredit);
}

const istToday = (): string => new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);

/**
 * GSTR-9 against the books (accounts brief G9): the year's filed returns beside the books, table by table, with the
 * accountant's note on each difference; and each month's GSTR-1 and GSTR-3B against the books (G7 "Books to returns").
 */
@Component({
	selector: 'app-gstr9-page',
	imports: [PageWrapper, TranslocoModule, FormsModule, HasPermissionDirective],
	templateUrl: './gstr9-page.html',
})
export class Gstr9Page {
	private readonly gateway = inject(GstReturnsGateway);
	private readonly company = inject(CompanyGateway);
	private readonly route = inject(ActivatedRoute);
	private readonly modals = inject(NgbModal);
	private readonly transloco = inject(TranslocoService);
	private readonly notifier = inject(NotificationService);
	private readonly queries = inject(QueryClient);

	readonly years = pastYears(istToday());
	readonly figure = figure;
	readonly agrees = monthAgrees;
	readonly money = (value: number | null) => (value === null ? '—' : rupees(value));
	private readonly asked = toSignal(this.route.queryParamMap.pipe(map((p) => p.get('year'))), { initialValue: null });
	readonly year = signal('');
	readonly registrationId = signal('');
	readonly busy = signal(false);

	readonly registrations = injectQuery(() => ({
		queryKey: COMPANY_KEYS.registrations,
		queryFn: () => firstValueFrom(this.company.registrations()),
	}));
	readonly active = computed(() => (this.registrations.data() ?? []).filter((r) => r.active !== false));
	readonly view = injectQuery(() => {
		const query = { gstRegistrationId: this.registrationId(), year: this.year() };
		return {
			queryKey: GST_KEYS.annual(query),
			queryFn: () => firstValueFrom(this.gateway.annual(query)),
			enabled: !!query.gstRegistrationId && !!query.year,
		};
	});

	// The note pop-up (G9 "Explained").
	readonly noteTable = signal<GstAnnualRow['table']>('4');
	readonly noteText = signal('');
	private noteModal: NgbModalRef | null = null;

	constructor() {
		// The year asked for in the address (from the calendar's GSTR-9 row), else last year; the first active GSTIN.
		effect(() => {
			if (!this.year()) this.year.set(this.asked() ?? (this.years[0] as string));
			const first = this.active()[0];
			if (first && !this.registrationId()) this.registrationId.set(first.id);
		});
	}

	openNote(template: TemplateRef<unknown>, row: GstAnnualRow): void {
		this.noteTable.set(row.table);
		this.noteText.set(row.note);
		this.noteModal = this.modals.open(template, { centered: true });
	}

	async saveNote(view: GstAnnual): Promise<void> {
		this.busy.set(true);
		try {
			await firstValueFrom(
				this.gateway.annualNote({
					gstRegistrationId: this.registrationId(),
					year: view.year,
					table: this.noteTable(),
					note: this.noteText(),
					version: view.version,
				}),
			);
			await this.queries.invalidateQueries({ queryKey: GST_KEYS.all });
			this.notifier.showSuccess(this.transloco.translate('gstr9_note_saved'));
			this.noteModal?.close();
		} catch (error) {
			this.notifier.showError(this.transloco.translate(gstProblem(error)));
		} finally {
			this.busy.set(false);
		}
	}

	/** The tables and the months as a spreadsheet file (opens in Excel). */
	download(view: GstAnnual): void {
		const t = (key: string) => this.transloco.translate(key);
		downloadCsv(
			`GSTR9_${view.gstin}_${view.year}.csv`,
			[
				t('gst_col_table'),
				t('gstr9_col_returns'),
				t('gstr9_col_books'),
				t('gstr9_col_difference'),
				t('gstr9_col_explained'),
			],
			[
				...view.rows.map((row) => [
					t(`gstr9_table_${row.table}`),
					row.unit === 'count' ? row.returns : row.returns / 100,
					row.unit === 'count' ? row.books : row.books / 100,
					row.unit === 'count' ? row.returns - row.books : (row.returns - row.books) / 100,
					row.note,
				]),
				[],
				[
					t('gstr9_col_month'),
					t('gstr9_col_gstr1'),
					t('gstr9_col_books_tax'),
					t('gstr9_col_gstr3b'),
					t('gstr9_col_3b_credit'),
					t('gstr9_col_books_credit'),
				],
				...view.months.map((m) => [
					m.month,
					m.gstr1Tax === null ? null : m.gstr1Tax / 100,
					m.booksTax / 100,
					m.gstr3bTax === null ? null : m.gstr3bTax / 100,
					m.gstr3bCredit === null ? null : m.gstr3bCredit / 100,
					m.booksCredit / 100,
				]),
			],
		);
	}
}
