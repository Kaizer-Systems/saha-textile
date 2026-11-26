import { HttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';

import { firstValueFrom, of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { ProductDraftService } from './product-draft.service';
import { ProductService } from './product.service';

const http = () => ({
	get: vi.fn(() => of({})),
	post: vi.fn(() => of({})),
	delete: vi.fn(() => of(undefined)),
});

const inject = <T>(type: new (...args: never[]) => T, client: ReturnType<typeof http>) => {
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({ providers: [{ provide: HttpClient, useValue: client }] });
	return TestBed.inject(type);
};

describe('Product bulk and draft calls', () => {
	it('sends a bulk action with its dry run, and a redirect only for Discontinue', async () => {
		const client = http();
		const service = inject(ProductService, client);
		await firstValueFrom(service.bulk('go-live', ['p1'], true));
		expect(client.post).toHaveBeenLastCalledWith(
			expect.stringMatching(/\/admin\/catalog\/products\/bulk\/go-live$/),
			{
				ids: ['p1'],
				dryRun: true,
			},
		);
		await firstValueFrom(service.bulk('discontinue', ['p1'], false, '/collections/sarees'));
		expect(client.post).toHaveBeenLastCalledWith(expect.stringMatching(/bulk\/discontinue$/), {
			ids: ['p1'],
			dryRun: false,
			replacementPath: '/collections/sarees',
		});
		await firstValueFrom(service.addToSale({ eventId: null, lines: [], dryRun: true }));
		expect(client.post).toHaveBeenLastCalledWith(expect.stringMatching(/\/admin\/events\/sale-products$/), {
			eventId: null,
			lines: [],
			dryRun: true,
		});
	});

	it('lists, reads, saves and discards drafts', async () => {
		const client = http();
		const service = inject(ProductDraftService, client);
		await firstValueFrom(service.list({ scope: 'mine' }));
		expect(client.get).toHaveBeenLastCalledWith(expect.stringMatching(/product-drafts$/), {
			params: { scope: 'mine' },
		});
		await firstValueFrom(
			service.list({ scope: 'everyone', productId: 'p1', search: ' silk ', page: 2, pageSize: 10 }),
		);
		expect(client.get).toHaveBeenLastCalledWith(expect.anything(), {
			params: { scope: 'everyone', productId: 'p1', search: 'silk', page: '2', pageSize: '10' },
		});
		await firstValueFrom(service.get('pdr 1'));
		expect(client.get).toHaveBeenLastCalledWith(expect.stringMatching(/product-drafts\/pdr%201$/));
		const body = { kind: 'new' } as never;
		await firstValueFrom(service.save(null, body));
		expect(client.post).toHaveBeenLastCalledWith(expect.stringMatching(/product-drafts$/), body);
		await firstValueFrom(service.save('pdr_1', body));
		expect(client.post).toHaveBeenLastCalledWith(expect.stringMatching(/product-drafts\/pdr_1$/), body);
		await firstValueFrom(service.discard('pdr_1'));
		expect(client.delete).toHaveBeenCalledWith(expect.stringMatching(/product-drafts\/pdr_1$/));
	});
});
