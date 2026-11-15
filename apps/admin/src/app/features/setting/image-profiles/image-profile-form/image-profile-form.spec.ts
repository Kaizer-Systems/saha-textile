import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';

import { TranslocoService } from '@jsverse/transloco';
import { QueryClient } from '@tanstack/angular-query-experimental';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { MediaProfilesGateway } from '@core/media-profiles/media-profiles.gateway';
import { NotificationService } from '@data-access/services/notification.service';

import { ImageProfileForm } from './image-profile-form';

const query = vi.hoisted(() => ({ data: undefined as unknown as () => unknown }));
vi.mock('@data-access/queries/media-profiles.queries', async (original) => ({
	...(await original<object>()),
	injectMediaProfileQuery: () => ({ data: query.data }),
}));
vi.mock('@core/brand/brand.gateway', async (original) => ({
	...(await original<object>()),
	injectBrandQuery: () => ({ data: () => ({ themeColor: '#417394' }) }),
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

const setup = (key: string | null, loaded: unknown = null) => {
	query.data = signal<unknown>(loaded ? { profile: loaded, photos: 612 } : undefined);
	const gateway = {
		create: vi.fn((body: unknown) => of(body)),
		update: vi.fn((_key: string, body: unknown) => of(body)),
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
		],
	});
	TestBed.overrideComponent(ImageProfileForm, { set: { imports: [], template: '' } });
	const fixture = TestBed.createComponent(ImageProfileForm);
	fixture.detectChanges();
	return { form: fixture.componentInstance, gateway, notifier, router };
};

describe('ImageProfileForm (F02)', () => {
	it('loads a built-in profile: sizes per family, its fills, name kept', () => {
		const { form } = setup('product_3x4', product);
		expect(form.families()).toEqual(['thumb', 'zoom']);
		expect(form.form.controls.name.disabled).toBe(true);
		expect(form.form.getRawValue()).toMatchObject({ minPx: 1600, minEdge: 'short', minMode: 'refuse', maxMb: 25 });
		expect([...form.fills()]).toEqual(['white', 'blur', 'crop']);
		expect(form.familyKey('thumb')).toBe('profile_family_thumb');
		expect(form.ratio()).toBe('3 / 4');
		expect(form.fillOptions()).toEqual(['white', 'blur', 'colour', 'crop']);
	});

	it('adds and removes sizes, refusing a bad or repeated one, never the last', () => {
		const { form } = setup('product_3x4', product);
		form.setAdding('zoom', '2400');
		form.addSize('zoom');
		expect(form.widths()['zoom']).toEqual([2000, 2400]);
		form.setAdding('zoom', '2400');
		form.addSize('zoom');
		expect(form.error()).toBe('profile_size_invalid');
		form.removeSize('zoom', 2000);
		form.removeSize('zoom', 2400);
		expect(form.widths()['zoom']).toEqual([2400]);
	});

	it('saves an edit without the built-in name, and goes back to the list', async () => {
		const { form, gateway, router, notifier } = setup('product_3x4', product);
		form.toggleFill('crop');
		form.form.controls.quality.setValue(84);
		await form.save();
		const body = gateway.update.mock.calls[0]?.[1] as Record<string, unknown>;
		expect(body['name']).toBeUndefined();
		expect(body).toMatchObject({ fills: ['white', 'blur'], quality: 84, shape: { width: 3, height: 4 } });
		expect(notifier.showSuccess).toHaveBeenCalledWith('profile_saved');
		expect(router.navigate).toHaveBeenCalledWith(['/setting/image-profiles']);
	});

	it('adds a profile; keeping the photo’s shape sends no fills', async () => {
		const { form, gateway } = setup(null);
		form.form.patchValue({ name: 'Saree 2:3', keepShape: true });
		expect(form.form.controls.shapeWidth.disabled).toBe(true);
		form.toggleType('image/webp');
		await form.save();
		expect(gateway.create).toHaveBeenCalledWith(
			expect.objectContaining({
				name: 'Saree 2:3',
				shape: null,
				fills: [],
				accepts: ['image/jpeg', 'image/png', 'image/webp'],
			}),
		);
	});

	it('shows the refusal in its own words, and stops an empty form before sending', async () => {
		const { form, gateway } = setup('hero_21x9', { ...product, key: 'hero_21x9', builtIn: false });
		gateway.update.mockReturnValueOnce(
			throwError(() => new HttpErrorResponse({ status: 400, error: { issues: [{ code: 'keep_shape_fills' }] } })),
		);
		await form.save();
		expect(form.error()).toBe('profile_error_keep_shape_fills');
		form.form.controls.name.setValue('');
		await form.save();
		expect(form.error()).toBe('profile_form_invalid');
		expect(gateway.update).toHaveBeenCalledTimes(1);
	});
});

describe('ImageProfileForm fill previews', () => {
	it('draw the fills at the shape being typed', () => {
		const { form } = setup('product_3x4', product);
		expect(form.ratio()).toBe('3 / 4');
		form.form.patchValue({ shapeWidth: 21, shapeHeight: 9 });
		expect(form.ratio()).toBe('21 / 9');
	});
});
