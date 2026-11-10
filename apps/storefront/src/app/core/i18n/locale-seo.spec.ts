import { DOCUMENT } from '@angular/common';
import { TestBed } from '@angular/core/testing';
import { Meta } from '@angular/platform-browser';
import { NavigationEnd, Router } from '@angular/router';

import { RESPONSE } from '@analogjs/router/tokens';
import { Subject } from 'rxjs';
import { afterEach, describe, expect, it } from 'vitest';

import { runtimeConfig } from '@core/config/runtime-config';

import { ACTIVE_LOCALE } from './active-locale';
import { LocaleSeo, goneRouteMeta, notFoundRouteMeta } from './locale-seo';

/**
 * The language-aware head: what a search engine reads to pair the en and bn pages.
 *
 * Driven by real `NavigationEnd` events through a stand-in router, against the test document's
 * `<head>` — the same DOM calls the server render makes.
 */
function harness(locale: 'en' | 'bn', { onServer = false } = {}) {
	const events = new Subject<unknown>();
	// The activated route's data, as the router would hold it once a navigation lands.
	const leaf = { firstChild: null, data: {} as Record<string, unknown> };
	const response = { statusCode: 200 };
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{ provide: ACTIVE_LOCALE, useValue: locale },
			{ provide: Router, useValue: { events, routerState: { snapshot: { root: leaf } } } },
			onServer ? { provide: RESPONSE, useValue: response } : [],
		],
	});
	const seo = TestBed.inject(LocaleSeo);
	const doc = TestBed.inject(DOCUMENT);
	const navigate = (url: string, data: Record<string, unknown> = {}) => {
		leaf.data = data;
		events.next(new NavigationEnd(1, url, url));
	};
	const href = (selector: string) => doc.head.querySelector(selector)?.getAttribute('href') ?? null;
	const robots = () => TestBed.inject(Meta).getTag("name='robots'")?.content ?? null;
	return { seo, doc, navigate, href, robots, response };
}

const SITE = 'https://shop.example.test';
const originalSite = runtimeConfig.siteUrl;

afterEach(() => {
	runtimeConfig.siteUrl = originalSite;
	document.head
		.querySelectorAll(
			"link[rel='canonical'], link[rel='alternate'], meta[name='robots'], meta[property^='og:'], meta[property^='article:']",
		)
		.forEach((node) => node.remove());
});

describe('LocaleSeo', () => {
	it('names a public page in every language, the English page as x-default, and itself as canonical', () => {
		runtimeConfig.siteUrl = `${SITE}/`;
		const { navigate, href } = harness('bn');

		navigate('/collections/sarees?page=2');

		expect(href("link[rel='canonical']")).toBe(`${SITE}/bn/collections/sarees`);
		expect(href("link[rel='alternate'][hreflang='en']")).toBe(`${SITE}/en/collections/sarees`);
		expect(href("link[rel='alternate'][hreflang='bn']")).toBe(`${SITE}/bn/collections/sarees`);
		expect(href("link[rel='alternate'][hreflang='x-default']")).toBe(`${SITE}/en/collections/sarees`);
	});

	it('tells link previews the page language and, on a public page, its other languages', () => {
		runtimeConfig.siteUrl = SITE;
		const { navigate } = harness('bn');
		const meta = TestBed.inject(Meta);
		const alternates = () => meta.getTags("property='og:locale:alternate'").map((tag) => tag.content);

		navigate('/collections/sarees');
		navigate('/collections/silk');
		expect(meta.getTag("property='og:locale'")?.content).toBe('bn_IN');
		expect(alternates()).toEqual(['en_IN']);

		navigate('/cart');
		expect(meta.getTag("property='og:locale'")?.content).toBe('bn_IN');
		expect(alternates()).toEqual([]);
	});

	it('gives the home page its slashed address in each language', () => {
		runtimeConfig.siteUrl = SITE;
		const { navigate, href } = harness('en');

		navigate('/');

		expect(href("link[rel='canonical']")).toBe(`${SITE}/en/`);
		expect(href("link[rel='alternate'][hreflang='bn']")).toBe(`${SITE}/bn/`);
	});

	// Prefixed so the customer stays in Bengali; not a page anyone should find in a search.
	it('marks a private page noindex and withdraws the previous page’s alternates', () => {
		runtimeConfig.siteUrl = SITE;
		const { navigate, doc, robots } = harness('bn');

		navigate('/collections/sarees');
		navigate('/checkout');

		expect(robots()).toBe('noindex,follow');
		expect(doc.head.querySelectorAll("link[rel='canonical'], link[rel='alternate']")).toHaveLength(0);
	});

	it('clears a private page’s noindex on the way back to a public one', () => {
		runtimeConfig.siteUrl = SITE;
		const { seo, navigate, robots } = harness('en');

		navigate('/account/dashboard');
		// The app clears the last page's head at each navigation start.
		seo.resetDocument('Saha Textile');
		navigate('/product/red-katan');

		expect(robots()).toBeNull();
	});

	it('keeps a robots tag the new page set before its navigation ended', () => {
		runtimeConfig.siteUrl = SITE;
		const { seo, navigate, robots } = harness('en');

		seo.resetDocument('Saha Textile');
		seo.applyDocument({ robots: 'noindex,follow' });
		navigate('/about-us');

		expect(robots()).toBe('noindex,follow');
	});

	// An extra-placement category page shows its products but points everything at its home path.
	it('lets a page move the canonical, and the alternates follow it', () => {
		runtimeConfig.siteUrl = SITE;
		const { seo, navigate, href, doc } = harness('bn');

		navigate('/collections/sarees/pure-cotton/cotton-chikankari');
		seo.setCanonicalPath('/collections/dress-materials/cotton-chikankari');

		expect(href("link[rel='canonical']")).toBe(`${SITE}/bn/collections/dress-materials/cotton-chikankari`);
		expect(href("link[rel='alternate'][hreflang='en']")).toBe(
			`${SITE}/en/collections/dress-materials/cotton-chikankari`,
		);
		expect(doc.head.querySelectorAll("link[rel='canonical']")).toHaveLength(1);
		expect(doc.head.querySelectorAll("link[rel='alternate'][hreflang='en']")).toHaveLength(1);
	});

	// A mistyped or retired URL must not be indexed as a page of its own (a "soft 404").
	it('answers a not-found page with 404, noindex and no canonical or alternates', () => {
		runtimeConfig.siteUrl = SITE;
		const { navigate, doc, robots, response } = harness('bn', { onServer: true });

		navigate('/collections/sarees');
		navigate('/no-such-page', notFoundRouteMeta.data);

		expect(response.statusCode).toBe(404);
		expect(robots()).toBe('noindex,follow');
		expect(doc.head.querySelectorAll("link[rel='canonical'], link[rel='alternate']")).toHaveLength(0);
	});

	it('answers a gone page with 410 and noindex', () => {
		runtimeConfig.siteUrl = SITE;
		const { navigate, robots, response } = harness('en', { onServer: true });

		navigate('/gone', goneRouteMeta.data);

		expect(response.statusCode).toBe(410);
		expect(robots()).toBe('noindex,follow');
	});

	it('leaves the status of an ordinary page alone', () => {
		runtimeConfig.siteUrl = SITE;
		const { navigate, response } = harness('en', { onServer: true });

		navigate('/cart');
		navigate('/product/red-katan');

		expect(response.statusCode).toBe(200);
	});

	it('names the page address for link previews, and drops it on a private page', () => {
		runtimeConfig.siteUrl = SITE;
		const { navigate, doc } = harness('en');
		const ogUrl = () => doc.head.querySelector("meta[property='og:url']")?.getAttribute('content') ?? null;
		navigate('/blog/real-banarasi');
		expect(ogUrl()).toBe(`${SITE}/en/blog/real-banarasi`);
		navigate('/account/dashboard');
		expect(ogUrl()).toBeNull();
	});

	it('marks an article with its dates and tags, and every next page as a website again', () => {
		runtimeConfig.siteUrl = SITE;
		const { seo, navigate, doc } = harness('en');
		const content = (property: string) =>
			[...doc.head.querySelectorAll(`meta[property='${property}']`)].map((tag) => tag.getAttribute('content'));
		navigate('/blog/real-banarasi');
		seo.applyArticle({
			publishedTime: '2026-11-08T00:00:00.000Z',
			modifiedTime: '2026-11-09T00:00:00.000Z',
			section: 'Saree guides',
			tags: ['Banarasi', 'Wedding'],
		});
		seo.applyArticle({
			publishedTime: '2026-11-08T00:00:00.000Z',
			modifiedTime: '2026-11-09T00:00:00.000Z',
			tags: ['Silk'],
		});
		expect(content('og:type')).toEqual(['article']);
		expect(content('article:published_time')).toEqual(['2026-11-08T00:00:00.000Z']);
		expect(content('article:section')).toEqual([]);
		expect(content('article:tag')).toEqual(['Silk']);
		navigate('/blogs');
		expect(content('og:type')).toEqual(['website']);
		expect(content('article:published_time')).toEqual([]);
		expect(content('article:tag')).toEqual([]);
	});

	it('marks a product with its price and image text, and every next page as a website again', () => {
		runtimeConfig.siteUrl = SITE;
		const { seo, navigate, doc } = harness('en');
		const content = (property: string) =>
			[...doc.head.querySelectorAll(`meta[property='${property}']`)].map((tag) => tag.getAttribute('content'));
		navigate('/product/red-saree');
		seo.applyProduct({ priceINR: 2500, imageAlt: 'Red saree' });
		seo.applyProduct({ priceINR: 2400 });
		expect(content('og:type')).toEqual(['product']);
		expect(content('product:price:amount')).toEqual(['2400']);
		expect(content('product:price:currency')).toEqual(['INR']);
		expect(content('og:image:alt')).toEqual(['Red saree']);
		navigate('/collections/sarees');
		expect(content('og:type')).toEqual(['website']);
		expect(content('product:price:amount')).toEqual([]);
		expect(content('og:image:alt')).toEqual([]);
	});

	it('gives link previews the price, facts, stock and card size, and clears them on the next page', () => {
		runtimeConfig.siteUrl = SITE;
		const { seo, navigate, doc } = harness('en');
		const content = (property: string) =>
			[...doc.head.querySelectorAll(`meta[property='${property}']`)].map((tag) => tag.getAttribute('content'));
		navigate('/product/red-saree');
		seo.applyProduct({
			priceINR: 2400,
			shareTitle: 'Red saree · ₹2,400',
			shareDescription: 'Silk · Zari border. Now 20% off',
			inStock: false,
			cardImage: true,
		});
		expect(content('og:title')).toEqual(['Red saree · ₹2,400']);
		expect(content('og:description')).toEqual(['Silk · Zari border. Now 20% off']);
		expect(content('og:price:amount')).toEqual(['2400']);
		expect(content('og:price:currency')).toEqual(['INR']);
		expect(content('product:availability')).toEqual(['out of stock']);
		expect(content('og:image:width')).toEqual(['1200']);
		expect(content('og:image:height')).toEqual(['630']);
		expect(content('og:image:type')).toEqual(['image/jpeg']);
		navigate('/collections/sarees');
		for (const gone of ['og:price:amount', 'product:availability', 'og:image:width', 'og:image:type']) {
			expect(content(gone)).toEqual([]);
		}
	});

	it('leaves the image size unstated when the preview falls back to a plain photo', () => {
		runtimeConfig.siteUrl = SITE;
		const { seo, navigate, doc } = harness('en');
		navigate('/product/red-saree');
		seo.applyProduct({ priceINR: 2400, inStock: true });
		expect(doc.head.querySelector("meta[property='og:image:width']")).toBeNull();
		expect(doc.head.querySelector("meta[property='product:availability']")?.getAttribute('content')).toBe(
			'in stock',
		);
	});

	it('removes a page’s structured data when asked', () => {
		const { seo, doc } = harness('en');
		seo.applyJsonLd('blog-post', { '@type': 'BlogPosting' });
		expect(doc.getElementById('blog-post')).not.toBeNull();
		seo.removeJsonLd('blog-post');
		seo.removeJsonLd('blog-post');
		expect(doc.getElementById('blog-post')).toBeNull();
	});
});
