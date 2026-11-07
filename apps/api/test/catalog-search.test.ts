import { ServiceUnavailableException } from '@nestjs/common';
import { SearchUnavailableError, type SearchPort } from '@saha-textile/core-domain';
import type { FastifyRequest } from 'fastify';
import { describe, expect, it, vi } from 'vitest';

import type { CatalogPublicService } from '../src/catalog/catalog-public.service';
import type { CatalogRateLimit } from '../src/catalog/catalog-rate-limit';
import { CatalogSearchController } from '../src/catalog/catalog-search.controller';

const limits = { enforce: vi.fn().mockResolvedValue(undefined) } as unknown as CatalogRateLimit;
const request = { ip: '127.0.0.1' } as FastifyRequest;

describe('catalogue search', () => {
	it('answers with full cards, so results carry their real price and photo', async () => {
		const search = vi.fn().mockResolvedValue({ items: [{ id: 'prd_silk' }], total: 1, page: 1, pageSize: 24 });
		const card = { id: 'prd_silk', slug: 'silk', price: { kind: 'single', sellingINR: 4200 } };
		const cardsForIds = vi.fn().mockResolvedValue([card]);
		const controller = new CatalogSearchController(
			{ search } as unknown as SearchPort,
			{ cardsForIds } as unknown as CatalogPublicService,
			limits,
		);

		await expect(controller.searchProducts({ q: 'silk' }, request)).resolves.toEqual({ items: [card], total: 1 });
		expect(cardsForIds).toHaveBeenCalledWith(['prd_silk']);
	});

	it('says 503 when the index cannot be reached, and never falls back to Mongo', async () => {
		const search = vi.fn().mockRejectedValue(new SearchUnavailableError('Search is not configured'));
		const controller = new CatalogSearchController(
			{ search } as unknown as SearchPort,
			{ cardsForIds: vi.fn() } as unknown as CatalogPublicService,
			limits,
		);

		await expect(controller.searchProducts({ q: 'silk' }, request)).rejects.toBeInstanceOf(
			ServiceUnavailableException,
		);
	});
});
