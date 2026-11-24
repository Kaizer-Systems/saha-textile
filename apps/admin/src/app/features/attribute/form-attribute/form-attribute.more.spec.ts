import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';

import { TranslocoService } from '@jsverse/transloco';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { QueryClient } from '@tanstack/angular-query-experimental';
import { BehaviorSubject, of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { SwatchPictures } from '@core/catalog/swatch-pictures';
import { ActiveLanguages } from '@core/i18n/active-languages';
import { MediaGateway } from '@core/media/media.gateway';
import { AttributeService } from '@data-access/services/attribute.service';
import { NotificationService } from '@data-access/services/notification.service';

import { FormAttribute } from './form-attribute';

import type { AttributeDefinitionTerm } from '@saha-textile/contracts';

const term = (over: Record<string, unknown>): AttributeDefinitionTerm =>
	({
		code: 'red',
		label: {},
		slug: 'red',
		aliases: [],
		isBase: false,
		hidden: false,
		...over,
	}) as AttributeDefinitionTerm;

function render(terms: AttributeDefinitionTerm[]) {
	const modals = { open: vi.fn() };
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{
				provide: AttributeService,
				useValue: {
					getDefinitions: () =>
						of([
							{
								code: 'color',
								label: { en: 'Colour' },
								defaultRole: 'variation_axis',
								defaultDisplayStyle: 'image_tile',
								valueType: 'color',
								terms,
							},
						]),
				},
			},
			{ provide: Router, useValue: { navigateByUrl: vi.fn() } },
			{ provide: ActivatedRoute, useValue: { params: new BehaviorSubject({ id: 'color' }) } },
			{ provide: QueryClient, useValue: { invalidateQueries: vi.fn() } },
			{ provide: NotificationService, useValue: { showError: vi.fn() } },
			{
				provide: TranslocoService,
				useValue: { translate: (key: string) => key, selectTranslation: () => of({}) },
			},
			{ provide: MediaGateway, useValue: { get: () => throwError(() => new Error('gone')) } },
			{ provide: SwatchPictures, useValue: { need: vi.fn(), url: () => null } },
			{ provide: ActiveLanguages, useValue: { list: () => ['en', 'bn'] } },
			{ provide: NgbModal, useValue: modals },
		],
	});
	TestBed.overrideComponent(FormAttribute, { set: { imports: [], template: '' } });
	const fixture = TestBed.createComponent(FormAttribute);
	fixture.componentRef.setInput('type', 'edit');
	fixture.detectChanges();
	TestBed.tick();
	return { page: fixture.componentInstance, modals };
}

describe('an attribute form whose values are only partly written', () => {
	it('falls back to English, then nothing, in the preview, and to the value’s number in the to-do', () => {
		const { page } = render([
			term({ label: { en: 'Red' }, subLabel: { en: 'Deep' }, swatchAssetId: 'med_gone' }),
			term({ code: 'blue', label: { bn: 'নীল' }, subLabel: { bn: 'গাঢ়' } }),
			term({ code: 'green', label: { en: 'Green' } }),
		]);
		page.switchLanguage('bn');
		const [red, blue, green] = page.previewValues();
		expect(red).toMatchObject({ label: 'Red', subLabel: 'Deep', hex: null, picture: null });
		expect(blue).toMatchObject({ label: 'নীল', subLabel: 'গাঢ়' });
		expect(green).toMatchObject({ label: 'Green', subLabel: null });
		// Blue has no English name or second line: the to-do names it by its place.
		const english = page.gaps()['en'] ?? [];
		expect(english.filter((gap) => gap.name === '2').map((gap) => gap.key)).toEqual(['value_1', 'value_note_1']);
		// The picture could not be read: the value shows none.
		expect(page.picture(page.terms()[0] as AttributeDefinitionTerm)).toBeNull();
	});

	it('names the value in the cut popup by English, then its code, and keeps a picture with no version', async () => {
		const { page, modals } = render([term({ label: {}, swatchAssetId: 'med_1' })]);
		let named: unknown;
		modals.open.mockReturnValue({
			componentInstance: { start: (ask: { valueName: string }) => (named = ask.valueName) },
			result: Promise.resolve(null),
		});
		page.switchLanguage('bn');
		await page.openCut(0, page.terms()[0] as AttributeDefinitionTerm);
		expect(named).toBe('red');
		await page.openCut(0, term({ label: { en: 'Red' }, swatchAssetId: 'med_1' }));
		expect(named).toBe('Red');
		page.setPicture(0, { id: 'med_2', original_url: 'b.webp' } as never);
		expect(page.terms()[0]).toMatchObject({ swatchAssetId: 'med_2' });
		expect(page.terms()[0]).not.toHaveProperty('swatchVersionId');
	});
});
