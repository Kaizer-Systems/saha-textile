import { inject } from '@angular/core';
import { injectQuery } from '@tanstack/angular-query-experimental';
import { firstValueFrom } from 'rxjs';

import { StateService } from '@data-access/services/state.service';

export function injectStatesQuery() {
	const stateService = inject(StateService);
	return injectQuery(() => ({
		queryKey: ['states'],
		queryFn: () => firstValueFrom(stateService.getStates()),
		staleTime: Infinity, // states are effectively static — load once and cache
	}));
}
