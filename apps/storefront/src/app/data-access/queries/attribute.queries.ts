import { inject } from '@angular/core';

import { injectQuery } from '@tanstack/angular-query-experimental';
import { firstValueFrom } from 'rxjs';

import { Params } from '@data-access/interfaces/core.interface';
import { AttributeService } from '@data-access/services/attribute.service';

/** Product attributes for the collection filter sidebar (replaces NGXS AttributeState). */
export function injectAttributesQuery(params: () => Params) {
  const attributeService = inject(AttributeService);
  return injectQuery(() => ({
    queryKey: ['attributes', params()],
    queryFn: () => firstValueFrom(attributeService.getAttributes(params())),
    staleTime: Infinity,
  }));
}
