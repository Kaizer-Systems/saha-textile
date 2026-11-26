import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';

import { TranslocoService } from '@jsverse/transloco';
import { QueryClient } from '@tanstack/angular-query-experimental';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { AdminLanguagesGateway } from '@core/admin-languages/admin-languages.gateway';
import { MediaGateway } from '@core/media/media.gateway';
import { AuthStore } from '@core/state/auth.store';
import { StoreLocationGateway } from '@core/stores/store-location.gateway';
import { NotificationService } from '@data-access/services/notification.service';

import { FormStoreLocation } from './form-store-location/form-store-location';
import { StoresSettings } from './stores';

const query = vi.hoisted(() => ({ data: undefined as unknown as () => unknown }));
vi.mock('@core/stores/store-location.gateway', async (original) => ({
	...(await original<object>()),
	injectStoreLocationsQuery: () => ({ data: query.data, isPending: () => false }),
}));

const row = (id: string) => ({
	store: { id, name: { en: id }, active: true, pinCode: '700124', phone: '+913325521595' },
	photos: [],
	gaps: [],
});

describe('Settings › Stores: the last cases', () => {
	it('opened from Settings › Languages, lists only the stores still missing that language', () => {
		query.data = signal<unknown>([row('a'), row('b')]);
		const params = convertToParamMap({ missing: 'bn' });
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({
			providers: [
				{ provide: StoreLocationGateway, useValue: {} },
				{ provide: QueryClient, useValue: { invalidateQueries: vi.fn() } },
				{ provide: NotificationService, useValue: { showSuccess: vi.fn(), showError: vi.fn() } },
				{ provide: TranslocoService, useValue: { translate: (key: string) => key } },
				{ provide: AuthStore, useValue: { permissions: () => ['setting.edit'] } },
				{
					provide: ActivatedRoute,
					useValue: { queryParamMap: of(params), snapshot: { queryParamMap: params } },
				},
				{ provide: AdminLanguagesGateway, useValue: { missing: vi.fn(() => of({ ids: ['b'] })) } },
			],
		});
		TestBed.overrideComponent(StoresSettings, { set: { imports: [], template: '' } });
		const fixture = TestBed.createComponent(StoresSettings);
		fixture.detectChanges();
		expect(fixture.componentInstance.rows().map((entry) => entry.store.id)).toEqual(['b']);
	});

	it('a store photo chosen with its version keeps that version', () => {
		const store = {
			id: 's1',
			name: { en: 'Barasat' },
			address: { en: 'KB Basu Rd' },
			landmark: {},
			pinCode: '700124',
			mapUrl: '',
			phone: '+913325521595',
			hours: [],
			photoAssetIds: ['p1', 'p2'],
			imageVersions: { p1: 'store_photo_4x3.blur' },
			active: true,
		};
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({
			providers: [
				{
					provide: StoreLocationGateway,
					useValue: { detail: vi.fn(() => of({ store, photos: [], gaps: [] })) },
				},
				{ provide: MediaGateway, useValue: { get: vi.fn((id: string) => of({ id })) } },
				{ provide: Router, useValue: { navigateByUrl: vi.fn() } },
				{ provide: QueryClient, useValue: { invalidateQueries: vi.fn() } },
				{ provide: NotificationService, useValue: { showSuccess: vi.fn(), showError: vi.fn() } },
				{ provide: ActivatedRoute, useValue: { snapshot: { params: { id: 's1' } } } },
				{ provide: TranslocoService, useValue: { translate: (key: string) => key, getActiveLang: () => 'en' } },
			],
		});
		TestBed.overrideComponent(FormStoreLocation, { set: { imports: [], template: '' } });
		const page = TestBed.createComponent(FormStoreLocation).componentInstance;
		expect(page.photos()).toEqual([{ id: 'p1', versionId: 'store_photo_4x3.blur' }, { id: 'p2' }]);
	});
});
