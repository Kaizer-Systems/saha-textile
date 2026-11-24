import { TestBed } from '@angular/core/testing';

import { TranslocoService } from '@jsverse/transloco';
import { NgbActiveModal, NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { ActiveLanguages } from '@core/i18n/active-languages';
import { MediaGateway } from '@core/media/media.gateway';
import { MediaLibraryGateway } from '@core/media-library/media-library.gateway';

import { ProductImages } from './product-images';
import { ProductPhoto } from './product-photo';

function images(result: () => Promise<unknown>) {
	const start = vi.fn();
	const modals = { open: vi.fn(() => ({ componentInstance: { start }, result: result() })) };
	const media = { details: vi.fn(() => throwError(() => new Error('gone'))) };
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{ provide: MediaGateway, useValue: media },
			{ provide: NgbModal, useValue: modals },
			{ provide: TranslocoService, useValue: { translate: (key: string) => key } },
		],
	});
	TestBed.overrideComponent(ProductImages, { set: { imports: [], template: '' } });
	const fixture = TestBed.createComponent(ProductImages);
	fixture.componentRef.setInput('value', {
		imageMode: 'simple',
		gallery: ['a'],
		compound: [],
		altOverrides: {},
		versions: { a: 'product_3x4.blur' },
	});
	fixture.componentRef.setInput('tiles', new Map());
	fixture.componentRef.setInput('combinations', []);
	fixture.componentRef.setInput('locale', 'en');
	fixture.detectChanges();
	return { page: fixture.componentInstance, start };
}

function photo(locales: string[], details: unknown) {
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{ provide: NgbActiveModal, useValue: { close: vi.fn(), dismiss: vi.fn() } },
			{ provide: MediaLibraryGateway, useValue: { details: vi.fn(() => details) } },
			{ provide: ActiveLanguages, useValue: { list: () => locales } },
			{ provide: TranslocoService, useValue: { translate: (key: string) => key } },
		],
	});
	TestBed.overrideComponent(ProductPhoto, { set: { imports: [], template: '' } });
	return TestBed.createComponent(ProductPhoto).componentInstance;
}

describe('product images: the last cases', () => {
	it('a Media picker closed without a choice adds nothing', async () => {
		const { page } = images(() => Promise.reject(new Error('closed')));
		await page.open(null);
		expect(page.value().gallery).toEqual(['a']);
	});

	it('adds a picked photo that has no thumbnail without a tile', () => {
		const { page } = images(() => Promise.resolve(null));
		page.addPicked([{ assetId: 'b', versionId: null, name: 'b.jpg', thumbnailUrl: null } as never]);
		expect(page.value().gallery).toEqual(['a', 'b']);
		expect(page.tiles().has('b')).toBe(false);
	});

	it('opens a photo whose library text cannot be read, and putting it back as it is drops its version', async () => {
		const { page, start } = images(() => Promise.resolve({ versionId: null, alt: {} }));
		await page.editPhoto('a');
		expect(start).toHaveBeenCalledWith(expect.objectContaining({ assetId: 'a', defaultAlt: {} }));
		expect(page.value().versions).toEqual({});
	});

	it('the photo popup: English with no languages, nothing before it starts, and a photo it cannot read', async () => {
		const popup = photo(
			[],
			throwError(() => new Error('gone')),
		);
		expect(popup.locale()).toBe('en');
		expect(popup.versions()).toEqual([]);
		expect(popup.elsewhere()).toBe('');
		await popup.start({
			assetId: 'med_r',
			thumbnailUrl: null,
			profileKey: 'product_3x4',
			versionId: null,
			alt: {},
			defaultAlt: {},
		});
		expect(popup.details()).toBeNull();
		expect(popup.versionId()).toBeNull();
		const none = photo(['en'], of({ name: 'x.jpg', usedOn: [], versions: [] }));
		await none.start({
			assetId: 'med_r',
			thumbnailUrl: null,
			profileKey: 'product_3x4',
			versionId: null,
			alt: {},
			defaultAlt: {},
		});
		expect(none.versionId()).toBeNull();
	});
});
