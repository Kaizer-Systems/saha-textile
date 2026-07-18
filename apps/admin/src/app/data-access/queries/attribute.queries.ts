import { inject } from '@angular/core';

import { injectQuery } from '@tanstack/angular-query-experimental';
import { firstValueFrom } from 'rxjs';

import { Params } from '@data-access/interfaces/core.interface';
import { AttributeService } from '@data-access/services/attribute.service';

export function injectAttributesQuery(params: () => Params) {
	const attributeService = inject(AttributeService);
	return injectQuery(() => ({
		queryKey: ['attributes', params()],
		queryFn: () => firstValueFrom(attributeService.getAttributes(params())),
	}));
}

export function injectAttributeValuesQuery(params: () => Params) {
	const attributeService = inject(AttributeService);
	return injectQuery(() => ({
		queryKey: ['attribute-values', params()],
		queryFn: () => firstValueFrom(attributeService.getAttributeValues(params())),
	}));
}
