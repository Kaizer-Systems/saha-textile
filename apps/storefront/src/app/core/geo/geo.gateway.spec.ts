import { HttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';

import { firstValueFrom, of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { runtimeConfig } from '@core/config/runtime-config';

import { GeoGateway, injectGeoCountryQuery } from './geo.gateway';

interface Options {
	queryKey: unknown[];
	queryFn: () => Promise<unknown>;
	enabled: boolean;
	staleTime: number;
}
const held = vi.hoisted(() => ({ options: null as null | (() => Options) }));

vi.mock('@tanstack/angular-query-experimental', () => ({
	injectQuery: (options: () => Options) => {
		held.options = options;
		return {};
	},
}));

const http = { get: vi.fn((url: string) => of({ url })) };

beforeEach(() => {
	http.get.mockClear();
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({ providers: [{ provide: HttpClient, useValue: http }] });
});

describe('GeoGateway', () => {
	it('reads the country list, one country in capitals and one PIN, each from the configured API', async () => {
		const geo = TestBed.inject(GeoGateway);
		const api = `${runtimeConfig.apiUrl}/geo`;

		await firstValueFrom(geo.countries());
		await firstValueFrom(geo.country('gb'));
		await firstValueFrom(geo.pin('700 001'));

		expect(http.get.mock.calls.map(([url]) => url)).toEqual([
			`${api}/countries`,
			`${api}/countries/GB`,
			`${api}/pin/700%20001`,
		]);
	});
});

describe('injectGeoCountryQuery', () => {
	it('keys the query by the code, fetches that country and keeps it a day', async () => {
		let code: string | null = 'in';
		TestBed.runInInjectionContext(() => injectGeoCountryQuery(() => code));
		const options = held.options?.() as Options;

		expect(options.queryKey).toEqual(['geo', 'country', 'in']);
		expect(options.enabled).toBe(true);
		expect(options.staleTime).toBe(24 * 60 * 60 * 1000);
		await expect(options.queryFn()).resolves.toEqual({ url: `${runtimeConfig.apiUrl}/geo/countries/IN` });

		code = null;
		expect(held.options?.().enabled).toBe(false);
	});
});
