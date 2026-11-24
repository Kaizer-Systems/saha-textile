import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';

import { TranslocoService } from '@jsverse/transloco';
import { BehaviorSubject, of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { AdminLanguagesGateway } from '@core/admin-languages/admin-languages.gateway';
import { AddonTemplateService } from '@data-access/services/addon-template.service';
import { FaqService } from '@data-access/services/faq.service';

import { AddonTemplate } from './addon-template/addon-template';
import { Faq } from './faq/faq';

vi.mock('@data-access/queries/faq.queries', () => ({
	injectFaqsQuery: (params: () => unknown) => (
		params(),
		{
			data: () => ({
				data: [
					{ faqId: 'faq_1', status: true },
					{ faqId: 'faq_2', status: false },
				],
				total: 2,
			}),
		}
	),
}));

/** A list opened from Settings › Languages with `?missing=bn`; the API names which rows still lack it. */
function render<T>(type: new (...args: never[]) => T, ids: string[], providers: unknown[]) {
	const params = new BehaviorSubject(convertToParamMap({ missing: 'bn' }));
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{ provide: ActivatedRoute, useValue: { queryParamMap: params, snapshot: { queryParamMap: params.value } } },
			{ provide: AdminLanguagesGateway, useValue: { missing: () => of({ ids }) } },
			{ provide: Router, useValue: { url: '/list', navigate: vi.fn(), navigateByUrl: vi.fn() } },
			{ provide: TranslocoService, useValue: { translate: (key: string) => key } },
			...(providers as never[]),
		],
	});
	TestBed.overrideComponent(type, { set: { imports: [], template: '' } });
	const fixture = TestBed.createComponent(type);
	fixture.detectChanges();
	TestBed.tick();
	return fixture.componentInstance;
}

describe('lists filtered to one language’s missing text', () => {
	it('FAQs: lists and counts only the questions still missing it', () => {
		const faqs = render(Faq, ['faq_2'], [{ provide: FaqService, useValue: {} }]);
		expect(faqs.tableConfig()).toMatchObject({ data: [{ faqId: 'faq_2', status: '0' }], total: 1 });
	});

	it('add-on templates: lists only the templates still missing it', () => {
		const rows = [
			{ code: 'fall', label: { en: 'Fall' }, priceINR: 100, fields: [], sizeGuide: [] },
			{ code: 'pico', label: { en: 'Pico' }, priceINR: 80, fields: [], sizeGuide: [] },
		];
		const templates = render(
			AddonTemplate,
			['pico'],
			[{ provide: AddonTemplateService, useValue: { list: () => of(rows) } }],
		);
		expect(templates.tableConfig()).toMatchObject({ data: [{ code: 'pico', name: 'Pico' }], total: 1 });
	});
});
