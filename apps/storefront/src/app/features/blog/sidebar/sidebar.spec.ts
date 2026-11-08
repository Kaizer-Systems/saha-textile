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
	injectBlogTermsQuery: (kind: string) => ({ data: kind === 'tags' ? tags : categories }),
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
		expect(await firstValueFrom(sidebar.tag$)).toEqual([]);
		expect(await firstValueFrom(sidebar.category$)).toEqual([]);
	});

	it('shows the loaded lists', async () => {
		recent.set([{ id: 1 }]);
		tags.set([{ slug: 'silk', name: 'Silk', count: 2 }]);
		categories.set([{ slug: 'guides', name: 'Guides', count: 3 }]);
		const sidebar = render();
		expect(await firstValueFrom(sidebar.resentBlog$)).toEqual([{ id: 1 }]);
		expect(await firstValueFrom(sidebar.tag$)).toEqual([{ slug: 'silk', name: 'Silk', count: 2 }]);
		expect(await firstValueFrom(sidebar.category$)).toEqual([{ slug: 'guides', name: 'Guides', count: 3 }]);
	});
});
