import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Meta } from '@angular/platform-browser';
import { ActivatedRoute } from '@angular/router';

import { TranslocoService } from '@jsverse/transloco';
import { BehaviorSubject, firstValueFrom } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SiteConfigStore } from '@core/state/site-config.store';
import { BlogService } from '@data-access/services/blog.service';

import { Blog } from './blog';
import { BlogDetails } from './blog-details/blog-details';

const list = signal<unknown>(undefined);
const fetching = signal(false);
const one = signal<unknown>(undefined);
vi.mock('@data-access/queries/blog.queries', () => ({
	injectBlogsQuery: (filter: () => unknown) => {
		filter();
		return { data: list, isFetching: fetching };
	},
	injectBlogBySlugQuery: (slug: () => unknown) => {
		slug();
		return { data: one };
	},
}));

afterEach(() => {
	list.set(undefined);
	one.set(undefined);
	fetching.set(false);
});

const theme = { blog: { blog_style: 'list', blog_sidebar_type: 'right_sidebar' } };

describe('Blog', () => {
	const render = (query: Record<string, string> = {}) => {
		const params = new BehaviorSubject(query);
		const service = { skeletonLoader: false };
		const siteConfig = signal<unknown>(theme);
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({
			providers: [
				{ provide: ActivatedRoute, useValue: { queryParams: params } },
				{ provide: BlogService, useValue: service },
				{ provide: SiteConfigStore, useValue: { siteConfig } },
				{ provide: TranslocoService, useValue: { translate: () => 'Blogs' } },
			],
		});
		TestBed.overrideComponent(Blog, { set: { imports: [], template: '' } });
		const page = TestBed.createComponent(Blog).componentInstance;
		TestBed.tick();
		return { page, params, service, siteConfig };
	};

	it('reads the layout from the site config by default', () => {
		const { page } = render();
		expect(page.style).toBe('list');
		expect(page.sidebar).toBe('right_sidebar');
		expect(page.breadcrumb).toEqual({ title: 'Blogs', items: [{ label: 'Blogs', active: true }] });
	});

	it('titles the page after the category, or else the tag', () => {
		expect(render({ category: 'bridal-wear' }).page.breadcrumb.title).toBe('Blogs: bridal wear');
		const { page } = render({ tag: 'silk-care' });
		expect(page.breadcrumb.title).toBe('Blogs: silk care');
		expect(page.filter()).toMatchObject({ tag: 'silk-care', category: '' });
	});

	it('takes the style and sidebar from the address when given', () => {
		const { page } = render({ style: 'grid', sidebar: 'no_sidebar' });
		expect(page.style).toBe('grid');
		expect(page.sidebar).toBe('no_sidebar');
		expect(render({ style: 'grid' }).page.sidebar).toBe('left_sidebar');
		expect(render({ sidebar: 'no_sidebar' }).page.style).toBeUndefined();
	});

	it('survives an empty theme for the style', () => {
		const { page, siteConfig } = render();
		siteConfig.set({ blog: {} });
		TestBed.tick();
		expect(page.style).toBeUndefined();
	});

	it('mirrors the fetch state and counts the results', async () => {
		const { page, service } = render();
		expect(page.totalItems()).toBe(0);
		fetching.set(true);
		list.set({ total: 7 });
		TestBed.tick();
		expect(service.skeletonLoader).toBe(true);
		expect(page.totalItems()).toBe(7);
		expect(await firstValueFrom(page.blog$)).toEqual({ total: 7 });
	});

	it('changes page', () => {
		const { page } = render();
		page.setPaginate(3);
		expect(page.filter()['page']).toBe(3);
	});
});

describe('BlogDetails', () => {
	const render = (query: Record<string, string> = {}) => {
		const meta = { updateTag: vi.fn() };
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({
			providers: [
				{
					provide: ActivatedRoute,
					useValue: {
						params: new BehaviorSubject({ slug: 'care' }),
						queryParams: new BehaviorSubject(query),
					},
				},
				{ provide: Meta, useValue: meta },
				{ provide: SiteConfigStore, useValue: { siteConfig: signal(theme) } },
			],
		});
		TestBed.overrideComponent(BlogDetails, { set: { imports: [], template: '' } });
		const page = TestBed.createComponent(BlogDetails).componentInstance;
		TestBed.tick();
		return { page, meta };
	};

	it('keeps the placeholder until the post arrives', () => {
		const { page, meta } = render();
		expect(page.breadcrumb.title).toBe('');
		expect(meta.updateTag).not.toHaveBeenCalled();
	});

	it('uses the sidebar from the address, or from the config', () => {
		expect(render({ sidebar: 'no_sidebar' }).page.sidebar).toBe('no_sidebar');
		expect(render().page.sidebar).toBe('right_sidebar');
	});

	it('titles the page and sets the social tags it has', async () => {
		const { page, meta } = render();
		one.set({ title: 'Saree care', meta_title: 'MT', meta_description: 'MD' });
		TestBed.tick();
		expect(page.breadcrumb.title).toBe('Saree care');
		expect(meta.updateTag.mock.calls.map(([tag]) => tag)).toEqual([
			{ property: 'og:title', content: 'MT' },
			{ property: 'og:description', content: 'MD' },
		]);
		expect(await firstValueFrom(page.blog$)).toMatchObject({ title: 'Saree care' });
	});

	it('skips the social tags a post lacks', () => {
		const { meta } = render();
		one.set({ title: 'Saree care' });
		TestBed.tick();
		expect(meta.updateTag).not.toHaveBeenCalled();
	});
});
