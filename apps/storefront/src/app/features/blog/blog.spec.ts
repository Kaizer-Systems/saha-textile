import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';

import { TranslocoService } from '@jsverse/transloco';
import { BehaviorSubject, firstValueFrom } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ACTIVE_LOCALE } from '@core/i18n/active-locale';
import { LocaleSeo } from '@core/i18n/locale-seo';
import { SiteConfigStore } from '@core/state/site-config.store';
import { IBlog } from '@data-access/interfaces/blog.interface';
import { BlogService } from '@data-access/services/blog.service';
import { ShopDatePipe } from '@shared/pipes/shop-date.pipe';

import { Blog } from './blog';
import { BlogDetails } from './blog-details/blog-details';

const list = signal<unknown>(undefined);
const fetching = signal(false);
const one = signal<unknown>(undefined);
const failure = signal<unknown>(null);
const categories = signal<unknown>(undefined);
const tags = signal<unknown>(undefined);
const brand = signal<unknown>(undefined);
vi.mock('@data-access/queries/blog.queries', () => ({
	injectBlogsQuery: (filter: () => unknown) => {
		filter();
		return { data: list, isFetching: fetching };
	},
	injectBlogBySlugQuery: (slug: () => unknown) => {
		slug();
		return { data: one, error: failure };
	},
	injectBlogTermsQuery: (kind: string) => ({ data: kind === 'tags' ? tags : categories }),
}));
vi.mock('@data-access/queries/brand.queries', () => ({ injectBrandQuery: () => ({ data: brand }) }));

afterEach(() => {
	for (const value of [list, one, categories, tags, brand]) value.set(undefined);
	failure.set(null);
	fetching.set(false);
});

const words: Record<string, string> = { blogs: 'Blogs', home: 'Home', blog_list_description: 'Guides and care tips' };
const transloco = { translate: (key: string) => words[key] ?? key, getActiveLang: () => 'en' };

const seoDouble = () => ({
	applyDocument: vi.fn(),
	applyJsonLd: vi.fn(),
	removeJsonLd: vi.fn(),
	applyArticle: vi.fn(),
	setCanonicalPath: vi.fn(),
	absoluteUrl: (path: string) => `https://shop.test/en${path === '/' ? '' : path}`,
	absoluteAsset: (url: string) => url,
});

describe('Blog', () => {
	const render = (query: Record<string, string> = {}) => {
		const params = new BehaviorSubject(query);
		const service = { skeletonLoader: false };
		const seo = seoDouble();
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({
			providers: [
				{ provide: ActivatedRoute, useValue: { queryParams: params } },
				{ provide: BlogService, useValue: service },
				{ provide: SiteConfigStore, useValue: { siteConfig: signal({}) } },
				{ provide: TranslocoService, useValue: transloco },
				{ provide: LocaleSeo, useValue: seo },
			],
		});
		TestBed.overrideComponent(Blog, { set: { imports: [], template: '' } });
		const fixture = TestBed.createComponent(Blog);
		TestBed.tick();
		return { page: fixture.componentInstance, fixture, params, service, seo };
	};

	it('uses the Blog list layout with the left sidebar, and names itself to search engines', () => {
		const { page, seo, fixture } = render();
		expect(page.style).toBe('list_view');
		expect(page.sidebar).toBe('left_sidebar');
		expect(page.breadcrumb()).toEqual({ title: 'Blogs', items: [{ label: 'Blogs', active: true }] });
		expect(seo.applyDocument).toHaveBeenLastCalledWith({
			title: 'Blogs | Saha Textile',
			description: 'Guides and care tips',
		});
		expect(seo.applyJsonLd).toHaveBeenCalledWith(
			'blog-crumbs',
			expect.objectContaining({ '@type': 'BreadcrumbList' }),
		);
		fixture.destroy();
		expect(seo.removeJsonLd).toHaveBeenCalledWith('blog-crumbs');
	});

	it('titles the page after the category or tag, by its name in the page language', () => {
		categories.set([{ slug: 'saree-guides', name: 'শাড়ির গাইড', count: 2 }]);
		const { page, seo } = render({ category: 'saree-guides' });
		expect(page.breadcrumb().title).toBe('Blogs: শাড়ির গাইড');
		expect(seo.applyDocument).toHaveBeenLastCalledWith(
			expect.objectContaining({ title: 'শাড়ির গাইড | Blogs | Saha Textile' }),
		);
		const tagged = render({ tag: 'silk-care' });
		expect(tagged.page.breadcrumb().title).toBe('Blogs: silk care');
		expect(tagged.page.filter()).toMatchObject({ tag: 'silk-care', category: '', page: 1, paginate: 10 });
	});

	it('mirrors the fetch state, counts the results and changes page', async () => {
		const { page, service } = render();
		expect(page.totalItems()).toBe(0);
		fetching.set(true);
		list.set({ total: 7 });
		TestBed.tick();
		expect(service.skeletonLoader).toBe(true);
		expect(page.totalItems()).toBe(7);
		expect(await firstValueFrom(page.blog$)).toEqual({ total: 7 });
		page.setPaginate(3);
		expect(page.filter()['page']).toBe(3);
	});
});

describe('BlogDetails', () => {
	const post: IBlog = {
		id: 'blg_1',
		title: 'Saree care',
		slug: 'saree-care',
		description: 'Fold, air, wrap',
		content: '<p>Care</p>',
		author: 'Saha Textile',
		published_at: '2026-11-08T00:00:00.000Z',
		created_at: '2026-11-08T00:00:00.000Z',
		updated_at: '2026-11-09T00:00:00.000Z',
		reading_minutes: 6,
		blog_thumbnail: { original_url: 'https://cdn/c.webp', srcset: '', alt: 'Silk', width: 2, height: 1 },
		share_image: null,
		categories: [{ slug: 'care', name: 'Care and styling' }],
		tags: [{ slug: 'silk', name: 'Silk' }],
		is_featured: false,
		is_sticky: 0,
		seo_title: 'Saree care | Saha Textile',
		seo_description: 'Fold, air, wrap',
	};

	const render = () => {
		const seo = seoDouble();
		const router = { navigate: vi.fn() };
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({
			providers: [
				{ provide: ActivatedRoute, useValue: { params: new BehaviorSubject({ slug: 'saree-care' }) } },
				{ provide: Router, useValue: router },
				{ provide: TranslocoService, useValue: transloco },
				{ provide: LocaleSeo, useValue: seo },
			],
		});
		TestBed.overrideComponent(BlogDetails, { set: { imports: [], template: '' } });
		const fixture = TestBed.createComponent(BlogDetails);
		TestBed.tick();
		return { page: fixture.componentInstance, fixture, seo, router };
	};

	it('keeps the placeholder until the post arrives', () => {
		const { page, seo } = render();
		expect(page.breadcrumb().title).toBe('');
		expect(seo.applyDocument).not.toHaveBeenCalled();
	});

	it('sends the post title, description, share card, article dates and structured data', async () => {
		brand.set({ icons: { '512': 'https://cdn/logo.png' } });
		const { page, seo, fixture } = render();
		one.set(post);
		TestBed.tick();
		expect(page.breadcrumb()).toEqual({
			title: 'Saree care',
			items: [
				{ label: 'Blogs', url: '/blogs', active: false },
				{ label: 'Saree care', active: true },
			],
		});
		expect(seo.setCanonicalPath).toHaveBeenCalledWith('/blog/saree-care');
		expect(seo.applyDocument).toHaveBeenCalledWith({
			title: 'Saree care | Saha Textile',
			description: 'Fold, air, wrap',
			image: 'https://cdn/c.webp',
		});
		expect(seo.applyArticle).toHaveBeenCalledWith({
			publishedTime: post.published_at,
			modifiedTime: post.updated_at,
			section: 'Care and styling',
			tags: ['Silk'],
		});
		const [, posting] = seo.applyJsonLd.mock.calls.find(([id]) => id === 'blog-post') ?? [];
		expect(posting).toMatchObject({
			'@type': 'BlogPosting',
			headline: 'Saree care',
			datePublished: post.published_at,
			image: ['https://cdn/c.webp'],
			publisher: { name: 'Saha Textile', logo: { url: 'https://cdn/logo.png' } },
			keywords: 'Silk',
		});
		const [, crumbs] = seo.applyJsonLd.mock.calls.find(([id]) => id === 'blog-post-crumbs') ?? [];
		expect(crumbs).toMatchObject({ '@type': 'BreadcrumbList' });
		expect(await firstValueFrom(page.blog$)).toMatchObject({ title: 'Saree care' });
		fixture.destroy();
		expect(seo.removeJsonLd).toHaveBeenCalledWith('blog-post');
	});

	it('falls back to the title, and leaves out what a post lacks', () => {
		const { seo } = render();
		one.set({ ...post, seo_title: '', categories: [], tags: [], blog_thumbnail: null });
		TestBed.tick();
		expect(seo.applyDocument).toHaveBeenCalledWith(
			expect.objectContaining({ title: 'Saree care | Saha Textile', image: undefined }),
		);
		const [, posting] = seo.applyJsonLd.mock.calls.find(([id]) => id === 'blog-post') ?? [];
		expect(posting).not.toHaveProperty('image');
		expect(posting).not.toHaveProperty('keywords');
		expect(posting.publisher).not.toHaveProperty('logo');
	});

	it('shows not found only when the API says so', () => {
		const { router } = render();
		failure.set(new Error('timeout'));
		TestBed.tick();
		expect(router.navigate).not.toHaveBeenCalled();
		failure.set(new HttpErrorResponse({ status: 404 }));
		TestBed.tick();
		expect(router.navigate).toHaveBeenCalledWith(['/404'], { skipLocationChange: true });
	});
});

describe('ShopDatePipe', () => {
	const pipe = (locale: string) => {
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({ providers: [{ provide: ACTIVE_LOCALE, useValue: locale }] });
		return TestBed.runInInjectionContext(() => new ShopDatePipe());
	};

	it('shows the Kolkata date without the time, English digits in Bengali', () => {
		expect(pipe('en').transform('2026-11-07T20:00:00.000Z')).toBe('8 Nov 2026');
		const bengali = pipe('bn').transform('2026-11-07T20:00:00.000Z');
		expect(bengali).toMatch(/^8 \S+ 2026$/);
		expect(bengali).not.toBe('8 Nov 2026');
		expect(pipe('en').transform(null)).toBe('');
		expect(pipe('en').transform('not a date')).toBe('');
	});
});
