import { Component, inject, signal } from '@angular/core';

import { TranslocoModule } from '@jsverse/transloco';
import { injectQuery } from '@tanstack/angular-query-experimental';
import { firstValueFrom } from 'rxjs';

import { REPORT_KEYS, ReportsGateway } from '@core/accounts/reports.gateway';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';
import { ACCOUNTS_PRESETS, PeriodPicker, type PeriodChoice } from '@shared/ui/period-picker/period-picker';

import { accountsRange } from '../accounts-period';
import { statementFigure } from './statement-page';

export const CASH_SECTIONS = ['operating', 'investing', 'financing'] as const;
export const RATIO_KEYS = [
	'currentRatio',
	'quickRatio',
	'grossMargin',
	'netMargin',
	'debtorDays',
	'creditorDays',
	'stockTurnover',
	'debtEquity',
] as const;

/** A ratio as shown: margins in percent, days as days, the rest as "× n". */
export function ratioText(key: string, value: number | null | undefined): string {
	if (value === null || value === undefined) return '—';
	if (key === 'grossMargin' || key === 'netMargin') return `${value}%`;
	if (key === 'debtorDays' || key === 'creditorDays') return `${Math.round(value)}`;
	return `${value}`;
}

/** Cash flow for a period, indirect method (accounts brief U1 "Cash flow"). */
@Component({
	selector: 'app-cash-flow-page',
	imports: [PageWrapper, TranslocoModule, PeriodPicker],
	templateUrl: './cash-flow-page.html',
})
export class CashFlowPage {
	private readonly gateway = inject(ReportsGateway);

	readonly presets = ACCOUNTS_PRESETS;
	readonly sections = CASH_SECTIONS;
	readonly figure = statementFigure;
	readonly range = signal(accountsRange({ period: 'this_fy' }));
	readonly report = injectQuery(() => ({
		queryKey: REPORT_KEYS.cashFlow(this.range()),
		queryFn: () => firstValueFrom(this.gateway.cashFlow(this.range())),
	}));

	setPeriod(choice: PeriodChoice): void {
		this.range.set(accountsRange(choice));
	}
}

/** The usual ratios for a period (accounts brief U1 "Ratios"). */
@Component({
	selector: 'app-ratios-page',
	imports: [PageWrapper, TranslocoModule, PeriodPicker],
	templateUrl: './ratios-page.html',
})
export class RatiosPage {
	private readonly gateway = inject(ReportsGateway);

	readonly presets = ACCOUNTS_PRESETS;
	readonly keys = RATIO_KEYS;
	readonly text = ratioText;
	readonly range = signal(accountsRange({ period: 'this_fy' }));
	readonly report = injectQuery(() => ({
		queryKey: REPORT_KEYS.ratios(this.range()),
		queryFn: () => firstValueFrom(this.gateway.ratios(this.range())),
	}));

	setPeriod(choice: PeriodChoice): void {
		this.range.set(accountsRange(choice));
	}
}
