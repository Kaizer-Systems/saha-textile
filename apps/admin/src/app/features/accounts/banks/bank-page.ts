import { Component, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';

import { TranslocoModule } from '@jsverse/transloco';
import { injectQuery } from '@tanstack/angular-query-experimental';
import { firstValueFrom, map } from 'rxjs';

import { BANK_KEYS, BanksGateway } from '@core/accounts/banks.gateway';
import { rupees } from '@features/accounts/ledger-helpers';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';
import { HasPermissionDirective } from '@shared/directives/has-permission.directive';

import { drCr } from './banks-list';

/** A bank account (accounts brief BA3): its details, its balance in the books, and its statement on the ledger page. */
@Component({
	selector: 'app-bank-page',
	imports: [PageWrapper, TranslocoModule, RouterLink, HasPermissionDirective],
	templateUrl: './bank-page.html',
})
export class BankPage {
	private readonly gateway = inject(BanksGateway);
	private readonly route = inject(ActivatedRoute);

	readonly id = toSignal(this.route.paramMap.pipe(map((p) => p.get('id') ?? '')), { initialValue: '' });
	readonly account = injectQuery(() => ({
		queryKey: BANK_KEYS.one(this.id()),
		queryFn: () => firstValueFrom(this.gateway.one(this.id())),
		enabled: !!this.id(),
	}));

	balance(paise: number): string {
		return drCr(paise);
	}

	money(inr: number | null): string {
		return inr === null ? '—' : rupees(Math.round(inr * 100));
	}
}
