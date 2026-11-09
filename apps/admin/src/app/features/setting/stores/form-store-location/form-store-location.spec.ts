import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';

import { TranslocoService } from '@jsverse/transloco';
import { QueryClient } from '@tanstack/angular-query-experimental';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { MediaGateway } from '@core/media/media.gateway';
import { StoreLocationGateway } from '@core/stores/store-location.gateway';
import { NotificationService } from '@data-access/services/notification.service';

import { FormStoreLocation, STORE_TIMES } from './form-store-location';

const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
const saved = {
	store: {
		id: 's1',
		name: { en: 'Saha Textile, Barasat', bn: 'সাহা টেক্সটাইল, বারাসাত' },
		address: { en: 'KB Basu Rd', bn: 'কে বি বসু রোড' },
		landmark: {},
		pinCode: '700124',
		mapUrl: 'https://maps.google.com/?cid=1',
		phone: '+913325521595',
		hours: DAYS.map((day) =>
			day === 'sun'
				? { day, open: false, opens: null, closes: null }
				: { day, open: true, opens: '10:00', closes: '20:30' },
		),
		photoAssetIds: ['p1', 'p2'],
		active: true,
	},
	photos: [],
	gaps: [],
};

const setup = (id?: string, row = saved) => {
	const gateway = {
		detail: vi.fn(() => of(row)),
		save: vi.fn((..._args: unknown[]) => of({ id: 's1', active: true, gaps: [] as unknown[] })),
	};
	const media = { get: vi.fn((assetId: string) => of({ id: assetId, original_url: `${assetId}.webp` })) };
	const router = { navigateByUrl: vi.fn() };
	const client = { invalidateQueries: vi.fn() };
	const notifier = { showSuccess: vi.fn(), showError: vi.fn() };
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{ provide: StoreLocationGateway, useValue: gateway },
			{ provide: MediaGateway, useValue: media },
			{ provide: Router, useValue: router },
			{ provide: QueryClient, useValue: client },
			{ provide: NotificationService, useValue: notifier },
			{ provide: ActivatedRoute, useValue: { snapshot: { params: id ? { id } : {} } } },
			{ provide: TranslocoService, useValue: { translate: (key: string) => key, getActiveLang: () => 'en' } },
		],
	});
	TestBed.overrideComponent(FormStoreLocation, { set: { imports: [], template: '' } });
	const page = TestBed.createComponent(FormStoreLocation).componentInstance;
	return { page, gateway, media, router, client, notifier };
};

describe('FormStoreLocation', () => {
	it('offers half-hour times from 06:00 to 23:30', () => {
		expect(STORE_TIMES[0]).toEqual({ value: '06:00', label: '06:00' });
		expect(STORE_TIMES.at(-1)).toEqual({ value: '23:30', label: '23:30' });
	});

	it('starts a new store closed every day', () => {
		const { page, gateway } = setup();
		expect(gateway.detail).not.toHaveBeenCalled();
		expect(page.hoursPreview()).toBe('Every day closed');
		expect(page.onSourceLanguage).toBe(true);
	});

	it('loads a saved store with its photos in order', () => {
		const { page, media } = setup('s1');
		expect(page.storeId()).toBe('s1');
		expect(page.form.controls.pinCode.value).toBe('700124');
		expect(page.form.controls.name.value).toBe('Saha Textile, Barasat');
		expect(page.hoursPreview()).toBe('Mon–Sat 10:00–20:30, Sun closed');
		expect(media.get).toHaveBeenCalledTimes(2);
		expect(page.photos().map((photo) => photo.id)).toEqual(['p1', 'p2']);
		const bare = setup('s2', { ...saved, store: { ...saved.store, photoAssetIds: [] } });
		expect(bare.media.get).not.toHaveBeenCalled();
	});

	it('switches language, lists the gaps and jumps to one', () => {
		const { page } = setup();
		page.form.patchValue({ name: 'Store', address: 'Road', landmark: 'Near the station' });
		page.refreshMissing();
		expect(page.gaps()['bn']?.map((gap) => gap.key)).toEqual(['name', 'address', 'landmark']);
		page.openLanguageGap({ key: 'name', locale: 'bn' });
		expect(page.fields.locale()).toBe('bn');
		expect(page.onSourceLanguage).toBe(false);
	});

	it('copies Monday to every day', () => {
		const { page } = setup();
		page.hours.at(0).patchValue({ open: true, opens: '11:00', closes: '19:00' });
		page.copyMonday();
		expect(page.hoursPreview()).toBe('Every day 11:00–19:00');
	});

	it('takes up to eight photos, one photo or none', () => {
		const { page } = setup();
		page.selectPhotos(Array.from({ length: 10 }, (_, index) => ({ id: `p${index}` }) as never));
		expect(page.photos()).toHaveLength(8);
		page.selectPhotos({ id: 'one' } as never);
		expect(page.photos()).toEqual([{ id: 'one' }]);
		page.selectPhotos(null);
		expect(page.photos()).toEqual([]);
	});

	it('needs an English name and address before saving', () => {
		const { page, gateway } = setup();
		page.submit();
		expect(gateway.save).not.toHaveBeenCalled();
		expect(page.form.controls.name.errors).toEqual({ required: true });
		page.form.patchValue({ name: 'Store' });
		page.submit();
		expect(page.form.controls.name.errors).toBeNull();
		expect(page.form.controls.address.errors).toEqual({ required: true });
		page.form.patchValue({ name: ' ', address: 'Road' });
		page.form.controls.address.setErrors(null);
		page.submit();
		expect(page.form.controls.name.errors).toEqual({ required: true });
		expect(page.form.controls.address.errors).toBeNull();
		expect(gateway.save).not.toHaveBeenCalled();
	});

	it('saves and returns to the list', () => {
		const { page, gateway, router, notifier, client } = setup('s1');
		page.selectPhotos([{ id: 'p9' } as never]);
		page.submit();
		expect(gateway.save).toHaveBeenCalledWith(
			's1',
			expect.objectContaining({
				name: { en: 'Saha Textile, Barasat', bn: 'সাহা টেক্সটাইল, বারাসাত' },
				photoAssetIds: ['p9'],
				active: true,
			}),
		);
		const body = gateway.save.mock.calls[0]?.[1] as unknown as { hours: { open: boolean; opens: string | null }[] };
		expect(body.hours.at(-1)).toEqual({ day: 'sun', open: false, opens: null, closes: null });
		expect(notifier.showSuccess).toHaveBeenCalledWith('store_saved');
		expect(client.invalidateQueries).toHaveBeenCalled();
		expect(router.navigateByUrl).toHaveBeenCalledWith('/setting/stores');
	});

	it('says what is missing when an active store cannot show yet', () => {
		const { page, gateway, notifier } = setup('s1');
		gateway.save.mockReturnValueOnce(of({ id: 's1', active: false, gaps: [{ field: 'hours', locale: null }] }));
		page.submit();
		expect(notifier.showError).toHaveBeenCalled();
	});

	it('marks the fields the API refuses', () => {
		const { page, gateway, router } = setup('s1');
		const refusal = new HttpErrorResponse({
			status: 400,
			error: { error: { issues: [{ path: ['pinCode'] }, { path: ['nothing'] }] } },
		});
		gateway.save.mockReturnValueOnce(throwError(() => refusal));
		page.submit();
		expect(page.form.controls.pinCode.errors).toEqual({ invalid: true });
		expect(router.navigateByUrl).not.toHaveBeenCalled();
		gateway.save.mockReturnValueOnce(throwError(() => new Error('down')));
		page.submit();
		expect(router.navigateByUrl).not.toHaveBeenCalled();
	});
});
