import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';

import { TranslocoService } from '@jsverse/transloco';
import { firstValueFrom, of } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LocaleSeo } from '@core/i18n/locale-seo';

import { AboutUs } from './about-us/about-us';
import { Faq } from './faq/faq';
import { Offer } from './offer/offer';

const blogs = signal<unknown>(undefined);
const faqs = signal<unknown>(undefined);
const faqPending = signal(true);
const coupons = signal<unknown>(undefined);
const couponPending = signal(true);
vi.mock('@data-access/queries/blog.queries', () => ({
	injectBlogsQuery: (params: () => unknown) => {
		params();
		return { data: blogs };
	},
}));
const faqSuccess = signal(false);
vi.mock('@data-access/queries/page.queries', () => ({
	injectFaqsQuery: () => ({ data: faqs, isPending: faqPending, isSuccess: faqSuccess }),
}));
vi.mock('@data-access/queries/coupon.queries', () => ({
	injectCouponsQuery: (params: () => unknown) => {
		params();
		return { data: coupons, isPending: couponPending };
	},
}));

const translate = {
	provide: TranslocoService,
	useValue: { selectTranslate: () => of('Title'), translate: (key: string) => `t:${key}` },
};
/** The public-page head: Router for the page's own address, LocaleSeo for what it writes. */
const headSeo = () => ({
	applyDocument: vi.fn(),
	applyBreadcrumbList: vi.fn(),
	applyJsonLd: vi.fn(),
	removeJsonLd: vi.fn(),
});
const pageAt = (url: string) => ({ provide: Router, useValue: { url } });

afterEach(() => {
	blogs.set(undefined);
	faqs.set(undefined);
	coupons.set(undefined);
	faqPending.set(true);
	faqSuccess.set(false);
	couponPending.set(true);
	vi.unstubAllGlobals();
});

describe('AboutUs', () => {
	it('shows the blog rail, and keeps its demo text out of search', async () => {
		const seo = headSeo();
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({
			providers: [translate, pageAt('/about-us'), { provide: LocaleSeo, useValue: seo }],
		});
		TestBed.overrideComponent(AboutUs, { set: { imports: [], template: '' } });
		const page = TestBed.createComponent(AboutUs).componentInstance;
		blogs.set({ data: [] });
		TestBed.tick();
		expect(await firstValueFrom(page.blog$)).toEqual({ data: [] });
		expect(page.breadcrumb()?.title).toBe('Title');
		// No visible heading of its own: the label is written as a hidden h1.
		expect(page.breadcrumb()?.hiddenHeading).toBe(true);
		expect(seo.applyDocument).toHaveBeenCalledWith({
			title: 'Title | Saha Textile',
			description: 't:about_us_meta_description',
			robots: 'noindex,follow',
		});
	});
});

describe('Faq', () => {
	const render = () => {
		const seo = headSeo();
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({
			providers: [translate, pageAt('/faq'), { provide: LocaleSeo, useValue: seo }],
		});
		TestBed.overrideComponent(Faq, { set: { imports: [], template: '' } });
		const page = TestBed.createComponent(Faq).componentInstance;
		TestBed.tick();
		return { page, seo };
	};

	it('shows the skeleton and no structured data while loading', async () => {
		const { page, seo } = render();
		expect(page.loading()).toBe(true);
		expect(page.items()).toEqual([]);
		expect(seo.applyJsonLd).not.toHaveBeenCalled();
		expect(seo.applyDocument).toHaveBeenCalledWith({
			title: 'Title | Saha Textile',
			description: 't:faq_meta_description',
			robots: undefined,
		});
		expect(await firstValueFrom(page.faq$)).toEqual({ data: [], total: 0 });
	});

	it('publishes the questions as structured data', () => {
		const { page, seo } = render();
		faqPending.set(false);
		faqSuccess.set(true);
		faqs.set({ data: [{ title: 'Q', description: 'A' }], total: 1 });
		TestBed.tick();
		expect(page.loading()).toBe(false);
		expect(seo.applyDocument).not.toHaveBeenCalledWith({ robots: 'noindex,follow' });
		expect(page.items()).toEqual([{ question: 'Q', answer: 'A' }]);
		expect(seo.applyJsonLd.mock.lastCall?.[1]).toMatchObject({
			mainEntity: [{ name: 'Q', acceptedAnswer: { text: 'A' } }],
		});
	});

	it('publishes nothing for an empty list, and keeps the empty page out of search', () => {
		const { seo } = render();
		faqs.set({ data: [], total: 0 });
		TestBed.tick();
		expect(seo.applyDocument).not.toHaveBeenCalledWith({ robots: 'noindex,follow' });
		faqSuccess.set(true);
		TestBed.tick();
		expect(seo.applyJsonLd).not.toHaveBeenCalled();
		expect(seo.applyDocument).toHaveBeenCalledWith({ robots: 'noindex,follow' });
	});
});

describe('Offer', () => {
	const render = () => {
		const seo = headSeo();
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({
			providers: [translate, pageAt('/offer'), { provide: LocaleSeo, useValue: seo }],
		});
		TestBed.overrideComponent(Offer, { set: { imports: [], template: '' } });
		const page = TestBed.createComponent(Offer).componentInstance;
		TestBed.tick();
		return { page, seo };
	};

	it('shows the skeleton until the coupons arrive, and stays out of search', async () => {
		const { page, seo } = render();
		expect(page.loading()).toBe(true);
		expect(seo.applyDocument).toHaveBeenCalledWith(expect.objectContaining({ robots: 'noindex,follow' }));
		couponPending.set(false);
		expect(page.loading()).toBe(false);
		expect(await firstValueFrom(page.coupon$)).toEqual({ data: [], total: 0 });
		coupons.set({ data: [{ id: 1 }], total: 1 });
		TestBed.tick();
		expect(await firstValueFrom(page.coupon$)).toMatchObject({ total: 1 });
	});

	it('copies a coupon code', () => {
		const writeText = vi.fn(async () => undefined);
		vi.stubGlobal('navigator', { clipboard: { writeText } });
		render().page.copyFunction('SAVE10');
		expect(writeText).toHaveBeenCalledWith('SAVE10');
	});
});
