import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { TranslocoService } from '@jsverse/transloco';
import { firstValueFrom, of } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LocaleSeo } from '@core/i18n/locale-seo';
import { CouponService } from '@data-access/services/coupon.service';
import { PageService } from '@data-access/services/page.service';

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
vi.mock('@data-access/queries/page.queries', () => ({
	injectFaqsQuery: () => ({ data: faqs, isPending: faqPending }),
}));
vi.mock('@data-access/queries/coupon.queries', () => ({
	injectCouponsQuery: (params: () => unknown) => {
		params();
		return { data: coupons, isPending: couponPending };
	},
}));

const translate = { provide: TranslocoService, useValue: { selectTranslate: () => of('Title') } };

afterEach(() => {
	blogs.set(undefined);
	faqs.set(undefined);
	coupons.set(undefined);
	faqPending.set(true);
	couponPending.set(true);
	vi.unstubAllGlobals();
});

describe('AboutUs', () => {
	it('shows the blog rail', async () => {
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({ providers: [translate] });
		TestBed.overrideComponent(AboutUs, { set: { imports: [], template: '' } });
		const page = TestBed.createComponent(AboutUs).componentInstance;
		blogs.set({ data: [] });
		TestBed.tick();
		expect(await firstValueFrom(page.blog$)).toEqual({ data: [] });
		expect(page.breadcrumb()?.title).toBe('Title');
	});
});

describe('Faq', () => {
	const render = () => {
		const service = { skeletonLoader: false };
		const seo = { applyJsonLd: vi.fn() };
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({
			providers: [translate, { provide: PageService, useValue: service }, { provide: LocaleSeo, useValue: seo }],
		});
		TestBed.overrideComponent(Faq, { set: { imports: [], template: '' } });
		const page = TestBed.createComponent(Faq).componentInstance;
		TestBed.tick();
		return { page, service, seo };
	};

	it('shows the skeleton and no structured data while loading', async () => {
		const { page, service, seo } = render();
		expect(service.skeletonLoader).toBe(true);
		expect(seo.applyJsonLd).not.toHaveBeenCalled();
		expect(await firstValueFrom(page.faq$)).toEqual({ data: [], total: 0 });
	});

	it('publishes the questions as structured data', () => {
		const { service, seo } = render();
		faqPending.set(false);
		faqs.set({ data: [{ title: 'Q', description: 'A' }], total: 1 });
		TestBed.tick();
		expect(service.skeletonLoader).toBe(false);
		expect(seo.applyJsonLd.mock.lastCall?.[1]).toMatchObject({
			mainEntity: [{ name: 'Q', acceptedAnswer: { text: 'A' } }],
		});
	});

	it('publishes nothing for an empty list', () => {
		const { seo } = render();
		faqs.set({ data: [], total: 0 });
		TestBed.tick();
		expect(seo.applyJsonLd).not.toHaveBeenCalled();
	});
});

describe('Offer', () => {
	const render = () => {
		const service = { skeletonLoader: false };
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({ providers: [translate, { provide: CouponService, useValue: service }] });
		TestBed.overrideComponent(Offer, { set: { imports: [], template: '' } });
		const page = TestBed.createComponent(Offer).componentInstance;
		TestBed.tick();
		return { page, service };
	};

	it('mirrors the load and lists the coupons', async () => {
		const { page, service } = render();
		expect(service.skeletonLoader).toBe(true);
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
