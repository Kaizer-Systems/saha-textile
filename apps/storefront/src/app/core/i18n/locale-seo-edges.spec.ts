import { DOCUMENT } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { Meta } from '@angular/platform-browser';
import { NavigationEnd, Router } from '@angular/router';

import { Subject, of, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ACTIVE_LOCALE } from './active-locale';
import { LocaleSeo } from './locale-seo';

const setup = (answer: unknown = of({ route: null }), root: unknown = { firstChild: null, data: {} }) => {
	const events = new Subject<unknown>();
	const http = { get: vi.fn(() => answer) };
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{ provide: ACTIVE_LOCALE, useValue: 'en' },
			{ provide: Router, useValue: { events, routerState: { snapshot: { root } } } },
			{ provide: HttpClient, useValue: http },
		],
	});
	const seo = TestBed.inject(LocaleSeo);
	return { seo, events, http, meta: TestBed.inject(Meta), doc: TestBed.inject(DOCUMENT) };
};
const tag = (meta: Meta, selector: string) => meta.getTag(selector)?.content ?? null;

afterEach(() => {
	document.head
		.querySelectorAll(
			"link[rel='canonical'], link[rel='alternate'], meta[name='robots'], meta[name='description'], meta[property^='og:'], #page-data",
		)
		.forEach((node) => node.remove());
});

describe('LocaleSeo.applyJsonLd', () => {
	it('creates the script once and replaces its content', () => {
		const { seo, doc } = setup();
		seo.applyJsonLd('page-data', { a: 1 });
		seo.applyJsonLd('page-data', { a: 2 });
		const scripts = doc.querySelectorAll('#page-data');
		expect(scripts).toHaveLength(1);
		expect(scripts[0]?.textContent).toBe('{"a":2}');
		expect(scripts[0]?.getAttribute('type')).toBe('application/ld+json');
	});
});

describe('LocaleSeo.applyDocument', () => {
	it('writes each tag it is given', () => {
		const { seo, doc, meta } = setup();
		seo.applyDocument({
			title: 'Red saree',
			description: '<p>Hand   woven</p>',
			robots: 'noindex',
			image: '/assets/a.jpg',
		});
		expect(doc.title).toBe('Red saree');
		expect(tag(meta, "property='og:title'")).toBe('Red saree');
		expect(tag(meta, "name='description'")).toBe('Hand woven');
		expect(tag(meta, "property='og:description'")).toBe('Hand woven');
		expect(tag(meta, "name='robots'")).toBe('noindex');
		expect(tag(meta, "property='og:image'")).toContain('/assets/a.jpg');
	});

	it('writes nothing for an empty input or a description with no words', () => {
		const { seo, meta } = setup();
		seo.applyDocument({});
		seo.applyDocument({ description: '<br/>' });
		expect(tag(meta, "name='description'")).toBeNull();
	});
});

describe('LocaleSeo addresses', () => {
	it('builds a page address in this language', () => {
		expect(setup().seo.absoluteUrl('/cart')).toMatch(/\/en\/cart$/);
	});

	it('keeps an absolute asset, and completes a relative one', () => {
		const { seo } = setup();
		expect(seo.absoluteAsset('https://cdn.test/a.jpg')).toBe('https://cdn.test/a.jpg');
		expect(seo.absoluteAsset('assets/a.jpg')).toMatch(/[^/]\/assets\/a\.jpg$/);
		expect(seo.absoluteAsset('/assets/a.jpg')).toMatch(/[^/]\/assets\/a\.jpg$/);
	});
});

describe('LocaleSeo stored head data', () => {
	const navigate = (events: Subject<unknown>, url = '/collections') => events.next(new NavigationEnd(1, url, url));

	it('asks for the page path in this language', () => {
		const { events, http } = setup();
		navigate(events, '/collections?page=2');
		expect(http.get.mock.lastCall).toBeDefined();
		expect((http.get.mock.lastCall as unknown as [string, { params: unknown }])[1].params).toEqual({
			path: '/collections',
			locale: 'en',
		});
	});

	it('treats an address with only a query as the home page', () => {
		const { events, http } = setup();
		navigate(events, '?x=1');
		expect((http.get.mock.lastCall as unknown as [string, { params: { path: string } }])[1].params.path).toBe('/');
	});

	it('does nothing when no record exists', () => {
		const { events, meta } = setup(of({ route: null }));
		navigate(events);
		expect(tag(meta, "name='description'")).toBeNull();
	});

	it('fills what the page did not set', () => {
		const { events, meta } = setup(of({ route: { title: 'T', description: 'Stored', robots: 'noindex' } }));
		navigate(events);
		expect(tag(meta, "name='description'")).toBe('Stored');
		expect(tag(meta, "name='robots'")).toBe('noindex');
	});

	it('leaves what the page already set', () => {
		const route = { title: 'T', description: 'Stored', robots: 'noindex' };
		const answer = new Subject<unknown>();
		const { seo, events, meta } = setup(answer);
		navigate(events);
		seo.applyDocument({ description: 'Own', robots: 'index,follow' });
		answer.next({ route });
		expect(tag(meta, "name='description'")).toBe('Own');
		expect(tag(meta, "name='robots'")).toBe('index,follow');
	});

	it('keeps the defaults when the read fails', () => {
		const { events, meta } = setup(throwError(() => new Error('down')));
		navigate(events);
		expect(tag(meta, "name='description'")).toBeNull();
	});

	it('reads the deepest route for not-found and gone', () => {
		const leaf = { firstChild: null, data: { notFound: true } };
		const { events, http } = setup(of({ route: null }), { firstChild: { firstChild: leaf, data: {} }, data: {} });
		navigate(events);
		expect(http.get).not.toHaveBeenCalled();
	});
});
