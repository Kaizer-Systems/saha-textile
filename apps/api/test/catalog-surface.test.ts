import { describe, expect, it } from 'vitest';

import { ProductsController } from '../src/catalog/products.controller';
import { catalogEtag } from '../src/catalog/catalog-etag.interceptor';

describe('public catalog surface', () => {
	it('does not expose a guest notify route', () => {
		expect('notify' in ProductsController.prototype).toBe(false);
	});

	it('changes the etag when the body changes', () => {
		expect(catalogEtag({ slug: 'a', price: 1 })).not.toBe(catalogEtag({ slug: 'a', price: 2 }));
	});
});
