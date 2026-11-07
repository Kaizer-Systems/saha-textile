import { HttpRequest } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';

import { firstValueFrom, of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { LoaderStore } from '@core/state/loader.store';

import { LoaderInterceptor } from './loader.interceptor';

const run = async (method: 'GET' | 'POST') => {
	const store = {
		showLoader: vi.fn(),
		showButtonSpinner: vi.fn(),
		hideLoader: vi.fn(),
		hideButtonSpinner: vi.fn(),
	};
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({ providers: [LoaderInterceptor, { provide: LoaderStore, useValue: store }] });
	const request = new HttpRequest(method as 'GET', '/x');
	await firstValueFrom(
		TestBed.inject(LoaderInterceptor).intercept(request, { handle: () => of({ type: 0 }) } as never),
	);
	await Promise.resolve();
	await Promise.resolve();
	return store;
};

describe('LoaderInterceptor', () => {
	it('shows the page loader for a read', async () => {
		const store = await run('GET');
		expect(store.showLoader).toHaveBeenCalledWith(true);
		expect(store.showButtonSpinner).toHaveBeenCalledWith(false);
		expect(store.hideLoader).toHaveBeenCalledOnce();
		expect(store.hideButtonSpinner).toHaveBeenCalledOnce();
	});

	it('shows the button spinner for a write', async () => {
		const store = await run('POST');
		expect(store.showLoader).toHaveBeenCalledWith(false);
		expect(store.showButtonSpinner).toHaveBeenCalledWith(true);
	});
});
