import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';

import { TranslocoService } from '@jsverse/transloco';
import { QueryClient } from '@tanstack/angular-query-experimental';
import { BehaviorSubject, of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { FaqService } from '@data-access/services/faq.service';
import { NotificationService } from '@data-access/services/notification.service';

import { FormFaq } from './form-faq';

vi.mock('@data-access/queries/category.queries', () => ({
	injectCategoriesQuery: (params: () => unknown) => (params(), { data: () => undefined }),
}));
vi.mock('@data-access/queries/product.queries', () => ({
	injectCatalogProductsQuery: (params: () => unknown) => (params(), { data: () => undefined }),
}));

describe('the FAQ form before the products answer', () => {
	it('offers no products and no categories yet', () => {
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({
			providers: [
				{ provide: FaqService, useValue: { getFaqs: () => of({ data: [] }) } },
				{ provide: Router, useValue: { navigateByUrl: vi.fn() } },
				{
					provide: ActivatedRoute,
					useValue: { params: new BehaviorSubject({}), snapshot: { paramMap: { get: () => null } } },
				},
				{ provide: QueryClient, useValue: { invalidateQueries: vi.fn() } },
				{ provide: NotificationService, useValue: { showSuccess: vi.fn(), showError: vi.fn() } },
				{ provide: TranslocoService, useValue: { translate: (key: string) => key } },
			],
		});
		TestBed.overrideComponent(FormFaq, { set: { imports: [], template: '' } });
		const form = TestBed.createComponent(FormFaq).componentInstance;
		expect(form.productOptions()).toEqual([]);
		expect(form.categoryOptions()).toEqual([]);
	});
});
