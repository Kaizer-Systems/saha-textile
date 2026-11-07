import { HttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';

import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { injectBrandQuery } from './brand.queries';

const captured = vi.hoisted(() => ({ options: undefined as unknown as () => { queryFn: () => Promise<unknown> } }));
vi.mock('@tanstack/angular-query-experimental', () => ({
	injectQuery: (options: () => { queryFn: () => Promise<unknown> }) => {
		captured.options = options;
		return {};
	},
}));
vi.mock('@core/config/runtime-config', () => ({
	runtimeConfig: { apiUrl: 'https://api.test' },
	runtimeConfigReady: Promise.resolve(),
}));

const read = (http: unknown) => {
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({ providers: [{ provide: HttpClient, useValue: http }] });
	TestBed.runInInjectionContext(() => injectBrandQuery());
	return captured.options().queryFn();
};

describe('injectBrandQuery', () => {
	it('reads the Brand Kit', async () => {
		const get = vi.fn(() => of({ shopName: 'Shop' }));
		expect(await read({ get })).toEqual({ shopName: 'Shop' });
		expect(get).toHaveBeenCalledWith('https://api.test/storefront/brand');
	});

	it('answers with no brand when the API cannot be reached', async () => {
		const get = () => throwError(() => new Error('down'));
		expect(await read({ get })).toEqual({ shopName: '', logo: null, seal: null, icons: {} });
	});
});
