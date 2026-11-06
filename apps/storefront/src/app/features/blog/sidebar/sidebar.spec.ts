import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { firstValueFrom } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { BlogService } from '@data-access/services/blog.service';

import { BlogSidebar } from './sidebar';

const recent = signal<unknown>(undefined);
const tags = signal<unknown>(undefined);
const categories = signal<unknown>(undefined);
vi.mock('@data-access/queries/blog.queries', () => ({
	injectRecentBlogsQuery: (params: () => unknown) => {
		params();
		return { data: recent };
	},
}));
vi.mock('@data-access/queries/tag.queries', () => ({
	injectTagsQuery: (params: () => unknown) => {
		params();
		return { data: tags };
	},
}));
vi.mock('@data-access/queries/category.queries', () => ({
	injectCategoriesQuery: (params: () => unknown) => {
		params();
		return { data: categories };
	},
}));

describe('BlogSidebar', () => {
	const render = () => {
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({ providers: [{ provide: BlogService, useValue: {} }] });
		TestBed.overrideComponent(BlogSidebar, { set: { imports: [], template: '' } });
		const sidebar = TestBed.createComponent(BlogSidebar).componentInstance;
		TestBed.tick();
		return sidebar;
	};

	it('shows empty lists until loaded', async () => {
		const sidebar = render();
		expect(await firstValueFrom(sidebar.resentBlog$)).toEqual([]);
		expect(await firstValueFrom(sidebar.tag$)).toEqual({ data: [], total: 0 });
		expect(await firstValueFrom(sidebar.category$)).toEqual({ data: [], total: 0 });
	});

	it('shows the loaded lists', async () => {
		recent.set([{ id: 1 }]);
		tags.set({ data: [{ id: 2 }], total: 1 });
		categories.set({ data: [{ id: 3 }], total: 1 });
		const sidebar = render();
		expect(await firstValueFrom(sidebar.resentBlog$)).toEqual([{ id: 1 }]);
		expect(await firstValueFrom(sidebar.tag$)).toMatchObject({ total: 1 });
		expect(await firstValueFrom(sidebar.category$)).toMatchObject({ total: 1 });
	});
});
