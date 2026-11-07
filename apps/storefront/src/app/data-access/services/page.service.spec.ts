import { HttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';

import { firstValueFrom, of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { PageService } from './page.service';

const setup = (get: (url: string) => unknown) => {
	const http = { get: vi.fn(get) };
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({ providers: [{ provide: HttpClient, useValue: http }] });
	return { service: TestBed.inject(PageService), http };
};

describe('PageService.getPage', () => {
	it('reads English straight from the page file', async () => {
		const { service, http } = setup(() => of({ title: 'Terms' }));
		expect(await firstValueFrom(service.getPage('terms'))).toEqual({ title: 'Terms' });
		expect(http.get.mock.lastCall?.[0]).toMatch(/pages\/terms\.json$/);
	});

	it('reads a language copy', async () => {
		const { service, http } = setup(() => of({ title: 'Conditions' }));
		expect(await firstValueFrom(service.getPage('terms', 'fr'))).toEqual({ title: 'Conditions' });
		expect(http.get.mock.calls.some(([url]) => /pages\/terms\.fr\.json$/.test(url))).toBe(true);
	});

	it('falls back to English when the language has no copy', async () => {
		const { service } = setup((url) =>
			url.endsWith('.fr.json') ? throwError(() => new Error('404')) : of({ title: 'Terms' }),
		);
		expect(await firstValueFrom(service.getPage('terms', 'fr'))).toEqual({ title: 'Terms' });
	});
});
