import { inject } from '@angular/core';

import { injectQuery } from '@tanstack/angular-query-experimental';
import { firstValueFrom } from 'rxjs';

import { StateService } from '@data-access/services/state.service';

/**
 * TanStack Query for states/provinces (replaces NGXS StateState + GetStatesAction).
 * Static reference data — cache indefinitely. The old NGXS `states` selector was
 * a filter FUNCTION (by country_id); consumers replicate that over `data()` via a
 * computed keyed on a selected-country signal (see address-modal, checklist 2d).
 */
export function injectStatesQuery() {
  const stateService = inject(StateService);
  return injectQuery(() => ({
    queryKey: ['states'],
    queryFn: () => firstValueFrom(stateService.getStates()),
    staleTime: Infinity,
  }));
}
