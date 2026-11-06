import { TestBed } from '@angular/core/testing';

import { QueryClient, provideTanStackQuery } from '@tanstack/angular-query-experimental';
import { EMPTY, Subject } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { ICategory, ICategoryModel } from '@data-access/interfaces/category.interface';
import { BlogService } from '@data-access/services/blog.service';
import { CategoryService } from '@data-access/services/category.service';

import { Menu } from './menu';

const category = (id: number, name: string, level: number, parent_id: number | null) =>
	({ id, name, level, parent_id, canonical_path: name.toLowerCase() }) as unknown as ICategory;

const taxonomy = {
	data: [category(1, 'Sarees', 1, null), category(2, 'Silk', 2, 1), category(3, 'Tussar', 3, 2)],
} as ICategoryModel;

/**
 * The server renders this menu, so it has to be derived with signals: a plain field written from
 * a subscription left the real links out of the server HTML. The real template (recursive
 * flyouts) is replaced with a thin one that reads the same binding.
 */
function harness() {
	const categories = new Subject<ICategoryModel>();
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			provideTanStackQuery(new QueryClient()),
			{ provide: CategoryService, useValue: { getCategories: () => categories } },
			{ provide: BlogService, useValue: { getBlogs: () => EMPTY } },
		],
	});
	TestBed.overrideComponent(Menu, {
		set: {
			imports: [],
			template: `@for (item of menu(); track $index) {<p class="item">{{ item.title }}</p>}`,
		},
	});
	const fixture = TestBed.createComponent(Menu);
	fixture.autoDetectChanges();
	const el: HTMLElement = fixture.nativeElement;
	const titles = () => [...el.querySelectorAll('.item')].map((item) => item.textContent);
	const answer = () => {
		categories.next(taxonomy);
		categories.complete();
	};
	return { fixture, titles, answer };
}

describe('the header menu', () => {
	it('splices the real branches in after Home, with no change detection of its own', async () => {
		const { titles, answer } = harness();
		const demo = titles();

		answer();

		await vi.waitFor(() => expect(titles()).toHaveLength(demo.length + 1));
		expect(titles()[0]).toBe(demo[0]);
		expect(titles()[1]).toBe('Sarees');
	});

	it('gives the offcanvas the shallow tree when the screen narrows', async () => {
		const { fixture, titles, answer } = harness();
		answer();
		await vi.waitFor(() => expect(titles()).toContain('Sarees'));
		const sarees = () => fixture.componentInstance.menu()[1];
		fixture.componentInstance.isMobileView.set(false);
		expect(sarees().children?.[0]?.type).toBe('sub');

		fixture.componentInstance.isMobileView.set(true);

		expect(sarees().children?.[0]?.type).toBe('link');
		expect(sarees().children?.at(-1)?.title).toBe('view_all');
	});
});
