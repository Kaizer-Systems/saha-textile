import { Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { injectQuery } from '@tanstack/angular-query-experimental';
import { firstValueFrom, map } from 'rxjs';

import { REPORT_KEYS, ReportsGateway } from '@core/accounts/reports.gateway';
import { LOCATION_KEYS, LocationsGateway } from '@core/locations/locations.gateway';
import { downloadCsv, shortDate } from '@core/purchasing/purchasing-format';
import { rupees } from '@features/accounts/ledger-helpers';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';

import type { FinancialStatement, StatementKind } from '@saha-textile/contracts';

/** A statement figure: credit-side lines read credit as positive, as the layout says. */
export function statementFigure(paise: number | null): string {
	if (paise === null) return '—';
	return `${paise < 0 ? '−' : ''}${rupees(paise)}`;
}

/** A row's indent by its depth, the same steps as Chart of accounts. */
export function indent(depth: number): string {
	return ['ps-2', 'ps-4', 'ps-5', 'ps-5 ms-3', 'ps-5 ms-5'][Math.min(depth, 4)] ?? 'ps-2';
}

/** The statement's rows and figures as a spreadsheet file. */
export function statementCsv(s: FinancialStatement): { header: string[]; rows: (string | number | null)[][] } {
	return {
		header: ['', s.asAt, ...(s.lastAsAt ? [s.lastAsAt] : [])],
		rows: s.rows.map((r) => [
			`${'  '.repeat(r.depth)}${r.label}`,
			r.thisYearPaise / 100,
			...(s.lastAsAt ? [r.lastYearPaise === null ? null : r.lastYearPaise / 100] : []),
		]),
	};
}

const istToday = (): string => new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);

/**
 * Balance sheet and profit and loss (accounts brief U2): the layout installed for the kind of business, as at a day,
 * with last year-end beside it, at every location or one. PDF prints the page; Excel saves a spreadsheet file.
 */
@Component({
	selector: 'app-statement-page',
	imports: [PageWrapper, TranslocoModule, FormsModule],
	templateUrl: './statement-page.html',
})
export class StatementPage {
	private readonly gateway = inject(ReportsGateway);
	private readonly locationsGateway = inject(LocationsGateway);
	private readonly route = inject(ActivatedRoute);
	private readonly transloco = inject(TranslocoService);

	readonly figure = statementFigure;
	readonly indent = indent;
	readonly kind = toSignal(this.route.paramMap.pipe(map((p) => (p.get('kind') ?? 'balanceSheet') as StatementKind)), {
		initialValue: 'balanceSheet' as StatementKind,
	});
	readonly asAt = signal(istToday());
	readonly locationId = signal('');
	readonly locations = injectQuery(() => ({
		queryKey: LOCATION_KEYS.list,
		queryFn: () => firstValueFrom(this.locationsGateway.list()),
	}));
	readonly active = computed(() => (this.locations.data() ?? []).filter((l) => l.active));
	readonly statement = injectQuery(() => {
		const query = { asAt: this.asAt(), ...(this.locationId() ? { locationId: this.locationId() } : {}) };
		return {
			queryKey: REPORT_KEYS.statement(this.kind(), query),
			queryFn: () => firstValueFrom(this.gateway.statement(this.kind(), query)),
			enabled: /^\d{4}-\d{2}-\d{2}$/.test(query.asAt),
		};
	});

	day(date: string): string {
		return shortDate(date);
	}

	print(): void {
		window.print();
	}

	download(s: FinancialStatement): void {
		const { header, rows } = statementCsv(s);
		downloadCsv(
			`${this.transloco.translate(`report_${this.kind() === 'balanceSheet' ? 'balance_sheet' : 'profit_loss'}`)}_${s.asAt}.csv`,
			header,
			rows,
		);
	}
}
