import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';

import { TranslocoService } from '@jsverse/transloco';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { QueryClient } from '@tanstack/angular-query-experimental';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { MediaUploads } from '@core/media-library/media-uploads';
import { MediaProfilesGateway } from '@core/media-profiles/media-profiles.gateway';
import { NotificationService } from '@data-access/services/notification.service';

import { ImageProfileForm } from './image-profile-form';

const query = vi.hoisted(() => ({
	data: undefined as unknown as () => unknown,
	brand: undefined as unknown,
}));
vi.mock('@data-access/queries/media-profiles.queries', async (original) => ({
	...(await original<object>()),
	injectMediaProfileQuery: () => ({ data: query.data }),
}));
vi.mock('@core/brand/brand.gateway', async (original) => ({
	...(await original<object>()),
	injectBrandQuery: () => ({ data: () => query.brand }),
}));

const product = {
	key: 'product_3x4',
	name: 'Product 3:4',
	builtIn: true,
	shape: { width: 3, height: 4 },
	roles: ['thumb', 'zoom'],
	widths: { thumb: [150, 300], zoom: [2000] },
	quality: null,
	fills: ['white', 'blur', 'crop'],
	minSize: { edge: 'short', px: 1600, mode: 'refuse' },
	maxBytes: 25 * 1024 * 1024,
	accepts: ['image/jpeg', 'image/png'],
	mainPhotoOnly: false,
	enabled: true,
	version: 1,
};

const preview = (photos: number, running = 0) => ({ photos, versions: photos, bytes: 1000, running, failed: 0 });

const setup = (
	key: string | null,
	loaded: unknown = null,
	answer: unknown = 'yes',
	template = '<ng-template #profileRefresh></ng-template>',
) => {
	query.data = signal<unknown>(loaded ? { profile: loaded, photos: 612 } : undefined);
	const gateway = {
		create: vi.fn((body: unknown) => of(body)),
		update: vi.fn((_key: string, body: unknown) => of(body)),
		refreshPreview: vi.fn(() => of(preview(0))),
		refresh: vi.fn(() => of({ started: 2, busy: 1 })),
	};
	const modals = { open: vi.fn(() => ({ result: answer === null ? Promise.reject() : Promise.resolve(answer) })) };
	// Runs the check it is handed, as the upload tray does while a refresh runs.
	const uploads = {
		followRefresh: vi.fn(
			async (_name: string, _count: number, check: () => Promise<unknown>) => void (await check()),
		),
	};
	const notifier = { showSuccess: vi.fn(), showError: vi.fn() };
	const router = { navigate: vi.fn() };
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{ provide: MediaProfilesGateway, useValue: gateway },
			{ provide: QueryClient, useValue: { invalidateQueries: vi.fn(async () => undefined) } },
			{ provide: NotificationService, useValue: notifier },
			{ provide: Router, useValue: router },
			{ provide: ActivatedRoute, useValue: { snapshot: { paramMap: new Map([['key', key]]) } } },
			{ provide: TranslocoService, useValue: { translate: (k: string) => k } },
			{ provide: NgbModal, useValue: modals },
			{ provide: MediaUploads, useValue: uploads },
		],
	});
	TestBed.overrideComponent(ImageProfileForm, {
		set: { imports: [], template },
	});
	const fixture = TestBed.createComponent(ImageProfileForm);
	fixture.detectChanges();
	return { form: fixture.componentInstance, gateway, notifier, router, modals, uploads };
};

const own = { ...product, key: 'own_banner', name: 'Own banner', builtIn: false };
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('ImageProfileForm: the last cases', () => {
	it('a new profile: no photos, its own family, the add title, the theme colour and a ratio once a side is empty', () => {
		query.brand = undefined;
		const { form } = setup(null);
		expect(form.photos()).toBe(0);
		expect(form.title()).toBe('profile_add');
		expect(form.displayName()).toBe('');
		expect(form.familyKey('own')).toBe('profile_family_own');
		expect(form.brandColour()).toBe('#417394');
		form.form.controls.shapeWidth.setValue(null);
		expect(form.ratio()).toBe('21 / 9');
		expect(form.fillName('white')).toBe('profile_fill_white');
	});

	it('names a profile that has not loaded yet as being edited', () => {
		const { form } = setup('own_banner');
		expect(form.title()).toBe('profile_edit');
	});

	it('an icon profile that keeps the shape: the icon fills, defaults for what it leaves out, and the Brand Kit colour', () => {
		query.brand = { themeColor: '#123456' };
		const icon = { ...own, key: 'icon', roles: ['brand_icon'], shape: null, minSize: null, fills: ['white'] };
		const { form } = setup('icon', icon);
		expect(form.photos()).toBe(612);
		expect(form.title()).toBe('profile_edit');
		expect(form.displayName()).toBe('Own banner');
		expect(form.familyKey('icon')).toBe('profile_family_own');
		expect(form.fillOptions()).toEqual(['white', 'brand']);
		expect(form.fillName('white')).toBe('profile_fill_white_background');
		expect(form.brandColour()).toBe('#123456');
		expect(form.form.getRawValue()).toMatchObject({
			shapeWidth: null,
			shapeHeight: null,
			keepShape: true,
			minPx: null,
			minEdge: 'width',
			minMode: 'warn',
		});
	});

	it('names a built-in profile, and handles a family it has no sizes for', () => {
		const { form } = setup('product_3x4', product);
		expect(form.displayName()).toBe('profile_name_product_3x4');
		form.removeSize('nope', 480);
		expect(form.widths()['nope']).toBeUndefined();
		form.setAdding('nope', '480');
		form.addSize('nope');
		expect(form.widths()['nope']).toEqual([480]);
	});

	it('adds a fill it lacked and drops a type it had', () => {
		const { form } = setup('product_3x4', product);
		form.toggleFill('colour');
		expect(form.fills().has('colour')).toBe(true);
		form.toggleType('image/jpeg');
		expect(form.accepts().has('image/jpeg')).toBe(false);
	});

	it('a save that fails for no stated reason says so', async () => {
		const { form, gateway } = setup('own_banner', own);
		gateway.update.mockReturnValueOnce(throwError(() => new Error('network')));
		await form.save();
		expect(form.error()).toBe('profile_error_unknown');
	});

	it('Bring older versions up to date: waits for a key and its popup, says a run is going, and follows a started run', async () => {
		const none = setup(null, own);
		await none.form.bringUpToDate();
		expect(none.gateway.refreshPreview).not.toHaveBeenCalled();
		const drawless = setup('own_banner', own, 'yes', '');
		await drawless.form.bringUpToDate();
		expect(drawless.gateway.refreshPreview).not.toHaveBeenCalled();

		const running = setup('own_banner', own);
		running.gateway.refreshPreview.mockReturnValueOnce(of(preview(0, 3)));
		await running.form.bringUpToDate();
		expect(running.notifier.showSuccess).toHaveBeenCalledWith('profile_refresh_running');

		const started = setup('own_banner', own);
		started.gateway.refreshPreview.mockReturnValue(of(preview(4)));
		started.gateway.refresh.mockReturnValueOnce(of({ started: 4, busy: 0 }));
		await started.form.bringUpToDate();
		await flush();
		expect(started.uploads.followRefresh).toHaveBeenCalledWith('Own banner', 4, expect.any(Function));
		expect(started.gateway.refreshPreview).toHaveBeenCalledTimes(2);
		expect(started.notifier.showError).not.toHaveBeenCalled();

		const idle = setup('own_banner', own);
		idle.gateway.refreshPreview.mockReturnValue(of(preview(4)));
		idle.gateway.refresh.mockReturnValueOnce(of({ started: 0, busy: 0 }));
		await idle.form.bringUpToDate();
		expect(idle.uploads.followRefresh).not.toHaveBeenCalled();

		const failed = setup('own_banner', own);
		failed.gateway.refreshPreview.mockReturnValueOnce(throwError(() => new Error('down')));
		await failed.form.bringUpToDate();
		expect(failed.notifier.showError).toHaveBeenCalledWith('profile_refresh_failed_start');
	});
});
