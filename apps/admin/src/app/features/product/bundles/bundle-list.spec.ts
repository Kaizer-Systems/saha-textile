import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';

import { TranslocoService } from '@jsverse/transloco';
import { QueryClient, provideTanStackQuery } from '@tanstack/angular-query-experimental';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { BundleService } from '@data-access/services/bundle.service';

import { BundleList } from './bundle-list';

describe('BundleList', () => {
	it('asks for the first page of bundles, 30 to a page, with no search', async () => {
		const list = vi.fn(() => of({ items: [], total: 0 }));
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({
			providers: [
				provideTanStackQuery(new QueryClient()),
				{ provide: PLATFORM_ID, useValue: 'browser' },
				{ provide: Router, useValue: { navigateByUrl: vi.fn() } },
				{ provide: BundleService, useValue: { list } },
				{
					provide: TranslocoService,
					useValue: { langChanges$: of('en'), getActiveLang: () => 'en', translate: (key: string) => key },
				},
			],
		});
		TestBed.overrideComponent(BundleList, { set: { imports: [], template: '' } });
		TestBed.createComponent(BundleList).detectChanges();
		await vi.waitFor(() => expect(list).toHaveBeenCalledWith({ search: undefined, page: 1, pageSize: 30 }));
	});
});
