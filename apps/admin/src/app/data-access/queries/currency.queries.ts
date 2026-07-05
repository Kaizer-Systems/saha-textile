import { inject } from '@angular/core';
import { injectQuery } from '@tanstack/angular-query-experimental';
import { firstValueFrom } from 'rxjs';

import { Params } from '@data-access/interfaces/core.interface';
import { CurrencyService } from '@data-access/services/currency.service';

export function injectCurrenciesQuery(params: () => Params) {
	const currencyService = inject(CurrencyService);
	return injectQuery(() => ({
		queryKey: ['currencies', params()],
		queryFn: () => firstValueFrom(currencyService.getCurrencies(params())),
	}));
}
