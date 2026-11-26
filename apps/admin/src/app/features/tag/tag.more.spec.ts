import { type Type } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';

import { TranslocoService } from '@jsverse/transloco';
import { QueryClient } from '@tanstack/angular-query-experimental';
import { BehaviorSubject, of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { AdminLanguagesGateway } from '@core/admin-languages/admin-languages.gateway';
import { BlogService } from '@data-access/services/blog.service';
import { NotificationService } from '@data-access/services/notification.service';

import { FormTag } from './form-tag/form-tag';
import { Tag } from './tag';

vi.mock('@data-access/queries/tag.queries', () => ({
	injectTagsQuery: (params: () => unknown) => (
		params(),
		{
			data: () => ({
				data: [
					{ id: 'btag_1', name: 'Weaving' },
					{ id: 'btag_2', name: 'Puja' },
				],
				total: 2,
			}),
		}
	),
	injectTagQuery: (id: () => unknown, type: () => unknown) => (id(), type(), { data: () => undefined }),
}));

function render<T>(type: Type<T>, blogs: Record<string, unknown>, inputs: Record<string, unknown> = {}) {
	const params = new BehaviorSubject(convertToParamMap({ missing: 'bn' }));
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{
				provide: ActivatedRoute,
				useValue: { queryParamMap: params, snapshot: { queryParamMap: params.value }, params: of({}) },
			},
			{ provide: AdminLanguagesGateway, useValue: { missing: () => of({ ids: ['btag_2'] }) } },
			{ provide: Router, useValue: { navigateByUrl: vi.fn() } },
			{ provide: BlogService, useValue: blogs },
			{ provide: QueryClient, useValue: { invalidateQueries: vi.fn() } },
			{ provide: NotificationService, useValue: { showSuccess: vi.fn(), showError: vi.fn() } },
			{ provide: TranslocoService, useValue: { translate: (key: string) => key } },
		],
	});
	TestBed.overrideComponent(type, { set: { imports: [], template: '' } });
	const fixture = TestBed.createComponent(type);
	for (const [name, value] of Object.entries(inputs)) fixture.componentRef.setInput(name, value);
	fixture.detectChanges();
	TestBed.tick();
	return fixture.componentInstance;
}

describe('blog tags opened from Settings › Languages', () => {
	it('lists and counts only the tags missing that language, and takes one off the shop', () => {
		const saveTerm = vi.fn(() => of({}));
		const deleteTerm = vi.fn(() => of(undefined));
		const tags = render(Tag, { saveTerm, deleteTerm }, { tagType: 'post' });
		expect(tags.tableConfig()).toMatchObject({ data: [{ id: 'btag_2' }], total: 1 });
		tags.status({
			id: 'btag_2',
			status: 0,
			blog: { id: 'btag_2', name: {}, description: {}, slug: 'puja' },
		} as never);
		expect(saveTerm).toHaveBeenCalledWith('tags', 'btag_2', expect.objectContaining({ status: 'draft' }));
		tags.deleteAll(null as never);
		expect(deleteTerm).not.toHaveBeenCalled();
	});
});

describe('the blog tag form edges', () => {
	const typed = (form: FormTag, slug: string, status: boolean) => {
		form.fields.load({ name: { en: 'Puja' }, description: {} });
		form.form.patchValue({ slug, status });
		form.submit();
	};

	it('keeps a typed address, saves a draft, and refuses a bad address', () => {
		const saveTerm = vi.fn(() => of({}));
		const form = render(FormTag, { saveTerm }, { tagType: 'post' });
		typed(form, 'puja-days', false);
		expect(saveTerm).toHaveBeenCalledWith(
			'tags',
			null,
			expect.objectContaining({ slug: 'puja-days', status: 'draft' }),
		);
		typed(form, 'Not An Address', true);
		expect(saveTerm).toHaveBeenCalledTimes(1);
	});

	it('still shows the refusal when saving fails', () => {
		const form = render(FormTag, { saveTerm: () => throwError(() => new Error('offline')) }, { tagType: 'post' });
		typed(form, 'puja', true);
		expect(TestBed.inject(NotificationService).showError).toHaveBeenCalled();
	});
});
