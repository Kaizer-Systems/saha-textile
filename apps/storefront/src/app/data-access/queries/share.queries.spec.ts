import { HttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';

import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { SHARE_DEFAULTS, injectShareSettingsQuery } from './share.queries';

const captured = vi.hoisted(() => ({
	options: undefined as unknown as () => { queryKey: unknown[]; queryFn: () => Promise<unknown> },
}));
vi.mock('@tanstack/angular-query-experimental', () => ({
	injectQuery: (options: () => { queryKey: unknown[]; queryFn: () => Promise<unknown> }) => {
		captured.options = options;
		return {};
	},
}));
vi.mock('@core/config/runtime-config', () => ({
	runtimeConfig: { apiUrl: 'https://api.test' },
	runtimeConfigReady: Promise.resolve(),
}));

const run = (http: unknown) => {
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({ providers: [{ provide: HttpClient, useValue: http }] });
	TestBed.runInInjectionContext(() => injectShareSettingsQuery());
	return captured.options();
};

describe('injectShareSettingsQuery', () => {
	it("reads the shop's Sharing choices", async () => {
		const answer = { ...SHARE_DEFAULTS, xHandle: 'SahaTextile' };
		const get = vi.fn(() => of(answer));
		const options = run({ get });
		expect(options.queryKey).toEqual(['share-settings']);
		expect(await options.queryFn()).toEqual(answer);
		expect(get).toHaveBeenCalledWith('https://api.test/catalog/share-settings');
	});

	it('lists every app when the API cannot be reached', async () => {
		const options = run({ get: () => throwError(() => new Error('down')) });
		expect(await options.queryFn()).toBe(SHARE_DEFAULTS);
	});
});
