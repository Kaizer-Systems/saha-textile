import { TestBed } from '@angular/core/testing';

import { TranslocoService } from '@jsverse/transloco';
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { ActiveLanguages } from '@core/i18n/active-languages';
import { MediaLibraryGateway } from '@core/media-library/media-library.gateway';

import { ProductPhoto } from './product-photo';

const details = {
	name: 'red-banarasi-front.jpg',
	usedOn: ['Red Banarasi Silk'],
	versions: [
		{ id: 'product_3x4.white', profileKey: 'product_3x4', fill: 'white', state: 'ready' },
		{ id: 'product_3x4.blur', profileKey: 'product_3x4', fill: 'blur', state: 'ready' },
		{ id: 'product_3x4.crop', profileKey: 'product_3x4', fill: 'crop', state: 'making' },
		{ id: 'hero_21x9.crop', profileKey: 'hero_21x9', fill: 'crop', state: 'ready' },
	],
};

const setup = () => {
	const modal = { close: vi.fn(), dismiss: vi.fn() };
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{ provide: NgbActiveModal, useValue: modal },
			{ provide: MediaLibraryGateway, useValue: { details: vi.fn(() => of(details)) } },
			{ provide: ActiveLanguages, useValue: { list: () => ['en', 'bn'] } },
			{ provide: TranslocoService, useValue: { translate: (key: string) => key } },
		],
	});
	TestBed.overrideComponent(ProductPhoto, { set: { imports: [], template: '' } });
	return { photo: TestBed.createComponent(ProductPhoto).componentInstance, modal };
};

describe('E05: a photo on this product (media step 4b)', () => {
	it('offers only this photo’s ready versions of the product’s profile, and keeps the one chosen', async () => {
		const { photo } = setup();
		await photo.start({
			assetId: 'med_r',
			thumbnailUrl: null,
			profileKey: 'product_3x4',
			versionId: 'product_3x4.blur',
			alt: {},
			defaultAlt: { en: 'Red saree' },
		});
		expect(photo.versions().map((one) => one.id)).toEqual(['product_3x4.white', 'product_3x4.blur']);
		expect(photo.versionId()).toBe('product_3x4.blur');
		expect(photo.elsewhere()).toBe('Red Banarasi Silk');
	});

	it('writes alt text per language and hands back the version and the non-empty texts', async () => {
		const { photo, modal } = setup();
		await photo.start({
			assetId: 'med_r',
			thumbnailUrl: null,
			profileKey: 'product_3x4',
			versionId: null,
			alt: { bn: ' ' },
			defaultAlt: {},
		});
		// No version stored yet: the first one offered.
		expect(photo.versionId()).toBe('product_3x4.white');
		photo.setAlt('Bridal Red Set: red Banarasi saree');
		photo.locale.set('bn');
		photo.setAlt('লাল বেনারসি');
		photo.save();
		expect(modal.close).toHaveBeenCalledWith({
			versionId: 'product_3x4.white',
			alt: { en: 'Bridal Red Set: red Banarasi saree', bn: 'লাল বেনারসি' },
		});
	});
});
