import { DOCUMENT } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';

import { TranslocoModule } from '@jsverse/transloco';
import { injectQuery } from '@tanstack/angular-query-experimental';
import { firstValueFrom, map } from 'rxjs';

import { BANK_KEYS, BanksGateway } from '@core/accounts/banks.gateway';
import { shortDate } from '@core/purchasing/purchasing-format';
import { rupees } from '@features/accounts/ledger-helpers';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';

import { drCr } from './banks-list';

/** Today in India. */
const today = (): string => new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);

/**
 * Bank reconciliation statement (accounts brief BA9): from the balance in the books, item by item, to the balance on the
 * bank's statement as at a day, with a tick when the two agree. Printed through the browser.
 */
@Component({
	selector: 'app-brs-page',
	imports: [PageWrapper, TranslocoModule, FormsModule],
	templateUrl: './brs-page.html',
})
export class BrsPage {
	private readonly gateway = inject(BanksGateway);
	private readonly route = inject(ActivatedRoute);
	private readonly document = inject(DOCUMENT);

	readonly id = toSignal(this.route.paramMap.pipe(map((p) => p.get('id') ?? '')), { initialValue: '' });
	readonly asAt = signal(today());

	readonly account = injectQuery(() => ({
		queryKey: BANK_KEYS.one(this.id()),
		queryFn: () => firstValueFrom(this.gateway.one(this.id())),
		enabled: !!this.id(),
	}));
	readonly brs = injectQuery(() => {
		const asAt = this.asAt();
		return {
			queryKey: BANK_KEYS.brs(this.id(), asAt),
			queryFn: () => firstValueFrom(this.gateway.brs(this.id(), asAt)),
			enabled: !!this.id() && !!asAt,
		};
	});

	balance(paise: number): string {
		return drCr(paise);
	}

	/** A step's amount as it changes the balance: "₹45,000.00" or "−₹12,000.00". */
	signed(paise: number): string {
		return `${paise < 0 ? '−' : ''}${rupees(paise)}`;
	}

	day(date: string): string {
		return shortDate(date);
	}

	print(): void {
		(this.document.defaultView as Window).print();
	}
}
