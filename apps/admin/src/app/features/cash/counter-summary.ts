import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { TranslocoModule } from '@jsverse/transloco';
import { injectQuery } from '@tanstack/angular-query-experimental';
import { firstValueFrom } from 'rxjs';

import { COUNTER_KEYS, CounterGateway, istToday } from '@core/counter/counter.gateway';
import { money } from '@core/orders/order-format';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';

import { istTime } from './cash-format';

import type { CounterSummaryQuery } from '@saha-textile/contracts';

/**
 * The counter summary (accounts brief P4): a store's day at the counter, bills by how they were paid, returns and
 * exchanges, the net, the bill numbers and times, and the day's sheet. The cashier's copy leaves out cash.
 */
@Component({
	selector: 'app-counter-summary',
	templateUrl: './counter-summary.html',
	imports: [TranslocoModule, FormsModule, PageWrapper],
})
export class CounterSummaryPage {
	private readonly gateway = inject(CounterGateway);

	readonly here = injectQuery(() => ({
		queryKey: COUNTER_KEYS.here,
		queryFn: () => firstValueFrom(this.gateway.here()),
	}));
	readonly date = signal(istToday());
	readonly picked = signal<string | null>(null);
	readonly locationId = computed(() => {
		const data = this.here.data();
		return this.picked() ?? data?.current ?? data?.stores[0]?.locationId ?? null;
	});
	readonly query = computed<CounterSummaryQuery | null>(() => {
		const locationId = this.locationId();
		return locationId ? { date: this.date(), locationId } : null;
	});
	readonly summary = injectQuery(() => ({
		queryKey: COUNTER_KEYS.summary(this.query()),
		queryFn: () => firstValueFrom(this.gateway.summary(this.query() as CounterSummaryQuery)),
		enabled: !!this.query(),
	}));

	rupees(amount: number): string {
		return money(amount, 'INR');
	}

	time(value: string | null): string {
		return value ? istTime(value) : '—';
	}

	print(): void {
		window.print();
	}
}
