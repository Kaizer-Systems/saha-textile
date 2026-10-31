import { DOCUMENT } from '@angular/common';
import { TestBed } from '@angular/core/testing';
import { Meta } from '@angular/platform-browser';
import { NavigationEnd, Router } from '@angular/router';

import { Subject } from 'rxjs';
import { afterEach, describe, expect, it } from 'vitest';

import { runtimeConfig } from '@core/config/runtime-config';

import { ACTIVE_LOCALE } from './active-locale';
import { LocaleSeo } from './locale-seo';

/**
 * The language-aware head: what a search engine reads to pair the en and fr pages.
 *
 * Driven by real `NavigationEnd` events through a stand-in router, against the test document's
 * `<head>` — the same DOM calls the server render makes.
 */
function harness(locale: 'en' | 'fr') {
	const events = new Subject<unknown>();
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{ provide: ACTIVE_LOCALE, useValue: locale },
			{ provide: Router, useValue: { events } },
		],
	});
	const seo = TestBed.inject(LocaleSeo);
	const doc = TestBed.inject(DOCUMENT);
	const navigate = (url: string) => events.next(new NavigationEnd(1, url, url));
	const href = (selector: string) => doc.head.querySelector(selector)?.getAttribute('href') ?? null;
	const robots = () => TestBed.inject(Meta).getTag("name='robots'")?.content ?? null;
	return { seo, doc, navigate, href, robots };
}

const SITE = 'https://shop.example.test';
const originalSite = runtimeConfig.siteUrl;

afterEach(() => {
	runtimeConfig.siteUrl = originalSite;
	document.head
		.querySelectorAll("link[rel='canonical'], link[rel='alternate'], meta[name='robots']")
		.forEach((node) => node.remove());
});

describe('LocaleSeo', () => {
	it('names a public page in every language, with / as x-default, and itself as canonical', () => {
		runtimeConfig.siteUrl = `${SITE}/`;
		const { navigate, href } = harness('fr');

		navigate('/collections/sarees?page=2');

		expect(href("link[rel='canonical']")).toBe(`${SITE}/fr/collections/sarees`);
		expect(href("link[rel='alternate'][hreflang='en']")).toBe(`${SITE}/en/collections/sarees`);
		expect(href("link[rel='alternate'][hreflang='fr']")).toBe(`${SITE}/fr/collections/sarees`);
		expect(href("link[rel='alternate'][hreflang='x-default']")).toBe(`${SITE}/`);
	});

	it('gives the home page its slashed address in each language', () => {
		runtimeConfig.siteUrl = SITE;
		const { navigate, href } = harness('en');

		navigate('/');

		expect(href("link[rel='canonical']")).toBe(`${SITE}/en/`);
		expect(href("link[rel='alternate'][hreflang='fr']")).toBe(`${SITE}/fr/`);
	});

	// Prefixed so the customer stays in French; not a page anyone should find in a search.
	it('marks a private page noindex and withdraws the previous page’s alternates', () => {
		runtimeConfig.siteUrl = SITE;
		const { navigate, doc, robots } = harness('fr');

		navigate('/collections/sarees');
		navigate('/checkout');

		expect(robots()).toBe('noindex,follow');
		expect(doc.head.querySelectorAll("link[rel='canonical'], link[rel='alternate']")).toHaveLength(0);
	});

	it('clears a private page’s noindex on the way back to a public one', () => {
		runtimeConfig.siteUrl = SITE;
		const { navigate, robots } = harness('en');

		navigate('/account/dashboard');
		navigate('/product/red-katan');

		expect(robots()).toBeNull();
	});

	// An extra-placement category page shows its products but points everything at its home path.
	it('lets a page move the canonical, and the alternates follow it', () => {
		runtimeConfig.siteUrl = SITE;
		const { seo, navigate, href, doc } = harness('fr');

		navigate('/collections/sarees/pure-cotton/cotton-chikankari');
		seo.setCanonicalPath('/collections/dress-materials/cotton-chikankari');

		expect(href("link[rel='canonical']")).toBe(`${SITE}/fr/collections/dress-materials/cotton-chikankari`);
		expect(href("link[rel='alternate'][hreflang='en']")).toBe(
			`${SITE}/en/collections/dress-materials/cotton-chikankari`,
		);
		expect(doc.head.querySelectorAll("link[rel='canonical']")).toHaveLength(1);
		expect(doc.head.querySelectorAll("link[rel='alternate'][hreflang='en']")).toHaveLength(1);
	});
});
