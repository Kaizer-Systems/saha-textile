import { HttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';

import { firstValueFrom, of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { PageService } from './page.service';

const setup = (get: (url: string, options?: unknown) => unknown) => {
	const http = { get: vi.fn(get) };
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({ providers: [{ provide: HttpClient, useValue: http }] });
	return { service: TestBed.inject(PageService), http };
};

describe('PageService.getPage (legal pages from the API, Legal Pages brief)', () => {
	it('asks the API for the page in the shop language; the API falls back to English', async () => {
		const { service, http } = setup(() => of({ title: 'গোপনীয়তা নীতি', updatedAt: '2026-11-15T00:00:00.000Z' }));
		expect(await firstValueFrom(service.getPage('privacy-policy', 'bn'))).toMatchObject({
			title: 'গোপনীয়তা নীতি',
		});
		expect(http.get.mock.lastCall?.[0]).toMatch(/\/catalog\/pages\/privacy-policy$/);
		expect(http.get.mock.lastCall?.[1]).toEqual({ params: { locale: 'bn' } });
	});
});
