import { inject } from '@angular/core';
import { injectQuery } from '@tanstack/angular-query-experimental';
import { firstValueFrom } from 'rxjs';

import { Params } from '@data-access/interfaces/core.interface';
import { TaxService } from '@data-access/services/tax.service';

export function injectTaxesQuery(params: () => Params) {
	const taxService = inject(TaxService);
	return injectQuery(() => ({
		queryKey: ['taxes', params()],
		queryFn: () => firstValueFrom(taxService.getTaxes(params())),
	}));
}
