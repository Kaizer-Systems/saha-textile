import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';

import { BehaviorSubject, firstValueFrom, of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { AdminLanguagesGateway } from '@core/admin-languages/admin-languages.gateway';

import { Category } from './category';

const tree = vi.hoisted(() => ({
	data: [
		{ id: 'bcat_1', name: 'Saree guides', subcategories: [] },
		{ id: 'bcat_2', name: 'Weaving', subcategories: [] },
	],
}));
vi.mock('@data-access/queries/category.queries', () => ({
	injectCategoriesQuery: (params: () => unknown) => {
		params();
		return { data: () => ({ data: tree.data, total: 2 }) };
	},
}));

describe('the blog category list opened from Settings › Languages', () => {
	it('keeps only the blog categories still missing that language', async () => {
		const params = new BehaviorSubject(convertToParamMap({ missing: 'bn' }));
		const missing = vi.fn(() => of({ ids: ['bcat_2'] }));
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({
			providers: [
				{
					provide: ActivatedRoute,
					useValue: { queryParamMap: params, snapshot: { queryParamMap: params.value } },
				},
				{ provide: AdminLanguagesGateway, useValue: { missing } },
			],
		});
		TestBed.overrideComponent(Category, { set: { imports: [], template: '' } });
		const fixture = TestBed.createComponent(Category);
		fixture.componentRef.setInput('categoryType', 'post');
		fixture.detectChanges();
		expect(fixture.componentInstance.missing().code()).toBe('bn');
		const shown = await firstValueFrom(fixture.componentInstance.category$);
		expect(shown?.data.map((row) => row.id)).toEqual(['bcat_2']);
		expect(missing).toHaveBeenCalledWith('blog_categories', 'bn');
	});
});
