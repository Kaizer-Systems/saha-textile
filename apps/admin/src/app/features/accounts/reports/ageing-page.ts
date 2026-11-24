import { Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { injectQuery } from '@tanstack/angular-query-experimental';
import { firstValueFrom, map } from 'rxjs';

import { REPORT_KEYS, ReportsGateway } from '@core/accounts/reports.gateway';
import { downloadCsv, shortDate } from '@core/purchasing/purchasing-format';
import { rupees } from '@features/accounts/ledger-helpers';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';

import type { AgeingSide, OutstandingAgeing } from '@saha-textile/contracts';

export const AGEING_BUCKETS = ['notDue', 'days1to30', 'days31to60', 'days61to90', 'over90', 'total'] as const;

/** Customer or supplier outstanding with ageing (accounts brief U5), on today's date; search narrows the parties. */
@Component({
	selector: 'app-ageing-page',
	imports: [PageWrapper, TranslocoModule, FormsModule],
	templateUrl: './ageing-page.html',
})
export class AgeingPage {
	private readonly gateway = inject(ReportsGateway);
	private readonly route = inject(ActivatedRoute);
	private readonly transloco = inject(TranslocoService);

	readonly buckets = AGEING_BUCKETS;
	readonly money = (paise: number) => (paise ? rupees(paise) : '—');
	readonly side = toSignal(this.route.paramMap.pipe(map((p) => (p.get('side') ?? 'customers') as AgeingSide)), {
		initialValue: 'customers' as AgeingSide,
	});
	readonly q = signal('');
	readonly report = injectQuery(() => ({
		queryKey: REPORT_KEYS.ageing(this.side()),
		queryFn: () => firstValueFrom(this.gateway.ageing(this.side())),
	}));
	readonly rows = computed(() => {
		const words = this.q().trim().toLowerCase();
		return (this.report.data()?.rows ?? []).filter((r) => !words || r.name.toLowerCase().includes(words));
	});

	day(date: string): string {
		return shortDate(date);
	}

	download(r: OutstandingAgeing): void {
		downloadCsv(
			`${r.side}-ageing_${r.asAt}.csv`,
			[
				this.transloco.translate('ageing_party'),
				...AGEING_BUCKETS.map((b) => this.transloco.translate(`ageing_${b}`)),
			],
			[...r.rows, { name: this.transloco.translate('total'), ...r.totals }].map((row) => [
				row.name,
				...AGEING_BUCKETS.map((b) => row[b] / 100),
			]),
		);
	}
}
