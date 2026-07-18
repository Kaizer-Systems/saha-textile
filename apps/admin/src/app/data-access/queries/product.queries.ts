import { inject } from '@angular/core';

import { injectQuery } from '@tanstack/angular-query-experimental';
import { firstValueFrom } from 'rxjs';

import { Params } from '@data-access/interfaces/core.interface';
import { ProductService } from '@data-access/services/product.service';

export function injectProductsQuery(params: () => Params) {
	const productService = inject(ProductService);
	return injectQuery(() => ({
		queryKey: ['products', params()],
		queryFn: () => firstValueFrom(productService.getProducts(params())),
	}));
}
