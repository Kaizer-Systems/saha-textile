import { PLATFORM_ID, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';

import { TranslocoService } from '@jsverse/transloco';
import { NEVER } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { LocaleSeo } from '@core/i18n/locale-seo';
import { ProductService } from '@data-access/services/product.service';

import { Home } from './home/home';
import { StaticPage } from './page/static-page/static-page';
import { type ResolvedPageSectionView, sectionClasses } from './page-builder/page-builder.types';
import { Blog } from './themes/widgets/blog/blog';

const page = signal<unknown>(undefined);
const blogs = signal<unknown>(undefined);
vi.mock('@data-access/queries/page.queries', () => ({ injectStaticPageQuery: () => ({ data: page }) }));
vi.mock('@data-access/queries/blog.queries', () => ({
	injectBlogsQuery: () => ({ data: blogs, isPending: () => false }),
}));
vi.mock('@data-access/queries/banner.queries', () => ({ injectBannersQuery: () => ({ data: signal(undefined) }) }));
vi.mock('@data-access/queries/page-layout.queries', () => ({
	injectPageLayoutQuery: () => ({ data: signal(undefined) }),
}));
vi.mock('@data-access/queries/youtube.queries', () => ({ injectVideoRailQuery: () => ({ data: signal(undefined) }) }));
vi.mock('@tanstack/angular-query-experimental', async (original) => ({
	...(await original<object>()),
	injectQuery: () => ({ data: signal(undefined), isPending: signal(true) }),
}));

describe('section spacing', () => {
	it('adds the outer gap below an extra-large section', () => {
		const section = {
			look: { spaceAbove: 'none', spaceBelow: 'xl', width: 'page', align: 'start', background: 'none' },
			screens: { phone: true, tablet: true, computer: true },
		} as ResolvedPageSectionView;
		expect(sectionClasses(section)).toBe('pt-0 pb-5 mb-5');
	});
});

describe('Home before its words have loaded', () => {
	it('names the page only once the translations arrive', () => {
		const seo = { applyDocument: vi.fn() };
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({
			providers: [
				{ provide: ProductService, useValue: {} },
				{ provide: PLATFORM_ID, useValue: 'browser' },
				{ provide: LocaleSeo, useValue: seo },
				{ provide: TranslocoService, useValue: { selectTranslate: () => NEVER } },
			],
		});
		TestBed.overrideComponent(Home, { set: { imports: [], template: '' } });
		TestBed.createComponent(Home).detectChanges();
		TestBed.tick();
		expect(seo.applyDocument).not.toHaveBeenCalled();
	});
});

describe('StaticPage before its date', () => {
	it('shows no Last updated line until the page says when it was saved', () => {
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({
			providers: [
				{ provide: Router, useValue: { url: '/terms-conditions' } },
				{
					provide: LocaleSeo,
					useValue: { applyDocument: vi.fn(), applyBreadcrumbList: vi.fn(), removeJsonLd: vi.fn() },
				},
				{ provide: TranslocoService, useValue: { translate: (key: string) => key } },
			],
		});
		TestBed.overrideComponent(StaticPage, { set: { imports: [], template: '' } });
		const view = TestBed.createComponent(StaticPage).componentInstance;
		page.set(undefined);
		expect(view.updatedAt()).toBeNull();
		page.set({ title: 'Terms', content: '' });
		expect(view.updatedAt()).toBeNull();
	});
});

describe('the blog row without chosen posts', () => {
	it('shows every live post when the section names none', () => {
		TestBed.resetTestingModule();
		TestBed.overrideComponent(Blog, { set: { imports: [], template: '' } });
		const fixture = TestBed.createComponent(Blog);
		fixture.componentRef.setInput('blogIds', undefined);
		blogs.set({ data: [{ id: 'a' }, { id: 'b' }] });
		expect(fixture.componentInstance.blogs()).toEqual([{ id: 'a' }, { id: 'b' }]);
	});
});
