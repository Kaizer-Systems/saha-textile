import { inject } from '@angular/core';

import { injectQuery } from '@tanstack/angular-query-experimental';
import { firstValueFrom } from 'rxjs';

import { Params } from '@data-access/interfaces/core.interface';
import { MockCustomerService } from '@data-access/services/user.service';

export function injectMockCustomersQuery(params: () => Params) {
	const mockCustomerService = inject(MockCustomerService);
	return injectQuery(() => ({
		queryKey: ['users', params()],
		queryFn: () => firstValueFrom(mockCustomerService.getUsers(params())),
	}));
}
