import { HttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';

import { firstValueFrom, of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { StoreLocationGateway, injectStoreLocationsQuery } from './store-location.gateway';

const captured = vi.hoisted(() => ({
	options: undefined as unknown as () => { queryFn: () => Promise<unknown>; enabled: boolean },
}));
vi.mock('@tanstack/angular-query-experimental', () => ({
	injectQuery: (options: () => { queryFn: () => Promise<unknown>; enabled: boolean }) => {
		captured.options = options;
		return {};
	},
}));
vi.mock('@core/config/runtime-config', () => ({ runtimeConfig: { apiUrl: 'https://api.test' } }));

const setup = () => {
	const http = {
		get: vi.fn(() => of('read')),
		post: vi.fn(() => of('posted')),
		delete: vi.fn(() => of('gone')),
	};
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({ providers: [{ provide: HttpClient, useValue: http }] });
	return { gateway: TestBed.inject(StoreLocationGateway), http };
};

describe('StoreLocationGateway', () => {
	it('calls the Settings › Stores API', async () => {
		const { gateway, http } = setup();
		const base = 'https://api.test/admin/store-locations';
		await firstValueFrom(gateway.list());
		expect(http.get).toHaveBeenLastCalledWith(base);
		await firstValueFrom(gateway.detail('a b'));
		expect(http.get).toHaveBeenLastCalledWith(`${base}/a%20b`);
		await firstValueFrom(gateway.save(null, {} as never));
		expect(http.post).toHaveBeenLastCalledWith(base, {});
		await firstValueFrom(gateway.save('s1', {} as never));
		expect(http.post).toHaveBeenLastCalledWith(`${base}/s1`, {});
		await firstValueFrom(gateway.setActive('s1', true));
		expect(http.post).toHaveBeenLastCalledWith(`${base}/s1/active`, { active: true });
		await firstValueFrom(gateway.reorder(['s2', 's1']));
		expect(http.post).toHaveBeenLastCalledWith(`${base}/order`, { ids: ['s2', 's1'] });
		await firstValueFrom(gateway.remove('s1'));
		expect(http.delete).toHaveBeenLastCalledWith(`${base}/s1`);
	});

	it('reads the list through a query that can wait for permission', async () => {
		setup();
		TestBed.runInInjectionContext(() => injectStoreLocationsQuery());
		expect(captured.options().enabled).toBe(true);
		expect(await captured.options().queryFn()).toBe('read');
		TestBed.runInInjectionContext(() => injectStoreLocationsQuery(() => false));
		expect(captured.options().enabled).toBe(false);
	});
});
