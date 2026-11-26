import { TestBed } from '@angular/core/testing';

import { TranslocoService } from '@jsverse/transloco';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { SwatchPictures } from '@core/catalog/swatch-pictures';
import { MediaGateway } from '@core/media/media.gateway';

import { OptionGroups } from './option-groups';

import type { ProductOptionGroup, ProductOptionTerm } from '@saha-textile/contracts';

const both = { en: 'Red', bn: 'লাল' };

const term = (code: string, extra: Record<string, unknown> = {}) =>
	({
		code,
		label: both,
		isBase: false,
		addonTemplateIds: [],
		requiresMeasurements: false,
		sortOrder: 0,
		...extra,
	}) as unknown as ProductOptionTerm;

const group = (terms: ProductOptionTerm[]) =>
	({
		attributeCode: 'color',
		label: both,
		semanticRole: 'variation_axis',
		displayStyle: 'picture_row',
		requiredSelection: false,
		defaultTermCode: null,
		terms,
	}) as unknown as ProductOptionGroup;

const definition = {
	id: 'attr_color',
	code: 'color',
	label: both,
	defaultRole: 'variation_axis',
	defaultDisplayStyle: 'color_swatch',
	valueType: 'color',
	terms: [
		{
			code: 'cut',
			label: both,
			slug: 'cut',
			swatchAssetId: 'a1',
			swatchVersionId: 'swatch_1x1.as_is',
			aliases: [],
			isBase: false,
			hidden: false,
		},
	],
};

function mount(groups: ProductOptionGroup[], result: Promise<unknown> = Promise.reject(new Error('closed'))) {
	result.catch(() => undefined);
	const start = vi.fn();
	const modals = { open: vi.fn(() => ({ componentInstance: { start }, result })) };
	const media = { get: vi.fn(() => throwError(() => new Error('gone'))) };
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{
				provide: TranslocoService,
				useValue: { translate: (key: string) => key, selectTranslation: () => of({}) },
			},
			{ provide: NgbModal, useValue: modals },
			{ provide: MediaGateway, useValue: media },
			{ provide: SwatchPictures, useValue: { need: vi.fn(), url: () => null } },
		],
	});
	TestBed.overrideComponent(OptionGroups, { set: { imports: [], template: '' } });
	const fixture = TestBed.createComponent(OptionGroups);
	fixture.componentRef.setInput('groups', groups);
	fixture.componentRef.setInput('definitions', [definition]);
	fixture.componentRef.setInput('locale', 'bn');
	fixture.detectChanges();
	TestBed.tick();
	return { page: fixture.componentInstance, modals, media, start };
}

describe('OptionGroups: the last cases', () => {
	it('keeps a picture it cannot fetch as unknown, and names a value with no name by its code', () => {
		const { page, media } = mount([group([term('red', { swatchAssetId: 'gone' })])]);
		expect(media.get).toHaveBeenCalledWith('gone');
		expect(page.tiles().has('gone')).toBe(false);
		expect(page.termLabel(term('plain', { label: {} }))).toBe('plain');
	});

	it('a picked value brings its cut picture with the cut’s own version', () => {
		const { page } = mount([group([])]);
		page.pick(0, page.groups()[0] as ProductOptionGroup, { value: ['cut'] } as never);
		expect(page.groups()[0]?.terms[0]).toMatchObject({
			swatchAssetId: 'a1',
			swatchVersionId: 'swatch_1x1.as_is',
		});
	});

	it('a cut popup closed without a picture changes nothing, and sends no price for a value without one', async () => {
		const red = term('red', { swatchAssetId: 'p1' });
		const { page, start } = mount([group([red])]);
		await page.openCut(0, page.groups()[0] as ProductOptionGroup, red);
		expect(start).toHaveBeenCalledWith(expect.objectContaining({ pictureId: 'p1', price: null }));
		expect(page.groups()[0]?.terms[0]).toBe(red);
	});

	it('the Media picker: closed, empty, or a picture with no thumbnail', async () => {
		const red = term('red');
		const closed = mount([group([red])]);
		await closed.page.openLibrary(0, 'red');
		expect(closed.page.groups()[0]?.terms[0]).toBe(red);
		const empty = mount([group([red])], Promise.resolve([]));
		await empty.page.openLibrary(0, 'red');
		expect(empty.page.groups()[0]?.terms[0]).toBe(red);
		const bare = mount([group([red])], Promise.resolve([{ assetId: 'lib', thumbnailUrl: null, versionId: null }]));
		await bare.page.openLibrary(0, 'red');
		expect(bare.page.tiles().get('lib')).toBe('');
		expect(bare.page.groups()[0]?.terms[0]).toMatchObject({ swatchAssetId: 'lib' });
	});
});
