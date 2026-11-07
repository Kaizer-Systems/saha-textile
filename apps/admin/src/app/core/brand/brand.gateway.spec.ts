import { HttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';

import { firstValueFrom, of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { BrandGateway, injectBrandQuery } from './brand.gateway';

const captured = vi.hoisted(() => ({ options: undefined as unknown as () => { queryFn: () => Promise<unknown> } }));
vi.mock('@tanstack/angular-query-experimental', () => ({
	injectQuery: (options: () => { queryFn: () => Promise<unknown> }) => {
		captured.options = options;
		return {};
	},
}));
vi.mock('@core/config/runtime-config', () => ({ runtimeConfig: { apiUrl: 'https://api.test' } }));

const setup = () => {
	const http = { get: vi.fn(() => of('read')), put: vi.fn(() => of('saved')) };
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({ providers: [{ provide: HttpClient, useValue: http }] });
	return { gateway: TestBed.inject(BrandGateway), http };
};

describe('BrandGateway', () => {
	it('reads the public brand and the settings, and saves', async () => {
		const { gateway, http } = setup();
		await firstValueFrom(gateway.brand());
		expect(http.get).toHaveBeenLastCalledWith('https://api.test/storefront/brand');
		await firstValueFrom(gateway.settings());
		expect(http.get).toHaveBeenLastCalledWith('https://api.test/admin/settings/brand');
		await firstValueFrom(gateway.save({ shopName: 'S', logoAssetId: null, sealAssetId: null }));
		expect(http.put).toHaveBeenCalledOnce();
	});

	it('answers with no brand when the API cannot be reached', async () => {
		const { http } = setup();
		TestBed.runInInjectionContext(() => injectBrandQuery());
		expect(await captured.options().queryFn()).toBe('read');
		http.get.mockReturnValue(throwError(() => new Error('down')) as never);
		expect(await captured.options().queryFn()).toEqual({ shopName: '', logo: null, seal: null, icons: {} });
	});
});
