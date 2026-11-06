import { DOCUMENT } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Meta } from '@angular/platform-browser';
import { NavigationEnd, Router } from '@angular/router';

import { RESPONSE } from '@analogjs/router/tokens';
import { filter } from 'rxjs';

import { runtimeConfig } from '@core/config/runtime-config';
import { backgroundRequest } from '@core/interceptors/background-request';

import { environment } from '../../../../public/environments/environment';

import { ACTIVE_LOCALE } from './active-locale';
import { SUPPORTED_LOCALES, isPrivatePath, withLocale } from './locale';

const NOT_FOUND_KEY = 'notFound';

/** Stored descriptions can hold markup; a search snippet cannot. */
const plainText = (html: string): string =>
	html
		.replace(/<[^>]*>/g, ' ')
		.replace(/\s+/g, ' ')
		.trim()
		.slice(0, 160);

const GONE_KEY = 'gone';

/**
 * The `routeMeta` of a page that stands for "nothing here": the catch-all and `/404`, which the
 * product page also lands on for an unknown slug.
 */
export const notFoundRouteMeta = { data: { [NOT_FOUND_KEY]: true } };

/** A retired address. `noindex`, and the server answers 410 rather than 404. */
export const goneRouteMeta = { data: { [GONE_KEY]: true } };

/**
 * The language-aware head of every page: canonical, `hreflang` alternates and the private-route
 * `noindex` (`DEC-I18N-ROUTES`).
 *
 * Every public page names itself in each language plus `x-default` → `/`, reciprocally, which is
 * what lets a search engine show the French page to a French searcher without the site ever
 * redirecting on a guess. Private pages (account, cart, checkout, sign-in…) get `noindex` and no
 * alternates — they are locale-prefixed so a customer stays in their language, not to be found.
 *
 * A not-found page ({@link notFoundRouteMeta}) is treated the same way, and on the server it also
 * answers `404`: otherwise every mistyped or retired URL is a `200` page claiming itself as
 * canonical, which a search engine indexes as a real page (a "soft 404").
 *
 * Defaults are applied on every navigation. A page that knows better — a category reached
 * through an extra placement, whose canonical is its home path — calls
 * {@link setCanonicalPath} after its data resolves.
 */
@Injectable({ providedIn: 'root' })
export class LocaleSeo {
	private doc = inject(DOCUMENT);
	private meta = inject(Meta);
	private router = inject(Router);
	private locale = inject(ACTIVE_LOCALE);
	/** Present only while rendering on the server. */
	private response = inject(RESPONSE, { optional: true });
	private http = inject(HttpClient);

	constructor() {
		this.router.events
			.pipe(filter((event): event is NavigationEnd => event instanceof NavigationEnd))
			.subscribe((event) => this.applyDefaults(event.urlAfterRedirects));
	}

	applyJsonLd(id: string, data: unknown): void {
		let script = this.doc.getElementById(id) as HTMLScriptElement | null;
		if (!script) {
			script = this.doc.createElement('script');
			script.id = id;
			script.type = 'application/ld+json';
			this.doc.head.appendChild(script);
		}
		script.textContent = JSON.stringify(data);
	}

	applyDocument(input: { title?: string; description?: string; robots?: string; image?: string }): void {
		if (input.title) {
			this.doc.title = input.title;
			this.meta.updateTag({ property: 'og:title', content: input.title });
		}
		const description = input.description && plainText(input.description);
		if (description) {
			this.meta.updateTag({ name: 'description', content: description });
			this.meta.updateTag({ property: 'og:description', content: description });
		}
		if (input.robots) this.meta.updateTag({ name: 'robots', content: input.robots });
		if (input.image) this.meta.updateTag({ property: 'og:image', content: this.absoluteAsset(input.image) });
	}

	/** A page address in this language, in full. */
	absoluteUrl(appPath: string): string {
		return this.absolute(withLocale(this.locale, appPath));
	}

	/** A stored file reference in full. Search engines and social cards ignore relative ones. */
	absoluteAsset(url: string): string {
		return /^https?:\/\//.test(url) ? url : this.absolute(`/${url.replace(/^\//, '')}`);
	}

	/**
	 * Points canonical and the alternates at `appPath` (locale-free, no query).
	 *
	 * Alternates always follow the canonical: each language version must name the same set of
	 * URLs, and a filtered or extra-placement URL is not one of them.
	 */
	setCanonicalPath(appPath: string): void {
		this.setLink('canonical', null, this.absolute(withLocale(this.locale, appPath)));
		for (const locale of SUPPORTED_LOCALES) {
			this.setLink('alternate', locale, this.absolute(withLocale(locale, appPath)));
		}
		this.setLink('alternate', 'x-default', this.absolute('/'));
	}

	private applyDefaults(appUrl: string): void {
		const path = appUrl.split(/[?#]/)[0] || '/';
		const notFound = this.isNotFound();
		const gone = this.isGone();
		// The address middleware may already have ruled this address gone; that answer stands.
		if (notFound && this.response && this.response.statusCode !== 410) this.response.statusCode = 404;
		if (gone && this.response) this.response.statusCode = 410;
		if (notFound || gone || isPrivatePath(path)) {
			this.meta.updateTag({ name: 'robots', content: 'noindex,follow' });
			this.doc.head
				.querySelectorAll("link[rel='canonical'], link[rel='alternate'][hreflang]")
				.forEach((link) => link.remove());
			return;
		}
		this.meta.removeTag("name='robots'");
		this.setCanonicalPath(path);
		this.applySeoRoute(path);
	}

	/** Stored head data fills what a page did not set itself; the page's own values win. */
	private applySeoRoute(appPath: string): void {
		this.http
			.get<{ route: { title: string; description: string; robots: string } | null }>(
				`${environment.apiUrl}/catalog/seo-route`,
				{ context: backgroundRequest(), params: { path: appPath, locale: this.locale } },
			)
			.subscribe({
				next: ({ route }) => {
					if (!route) return;
					if (!this.meta.getTag("name='description'")?.content) {
						this.applyDocument({ description: route.description });
					}
					if (!this.meta.getTag("name='robots'")) this.applyDocument({ robots: route.robots });
				},
				// The head defaults already stand; a page never fails over its meta tags.
				error: () => undefined,
			});
	}

	/** Whether the page now showing is declared a not-found page by its route. */
	private isNotFound(): boolean {
		let route = this.router.routerState.snapshot.root;
		while (route.firstChild) route = route.firstChild;
		return route.data[NOT_FOUND_KEY] === true;
	}

	private isGone(): boolean {
		let route = this.router.routerState.snapshot.root;
		while (route.firstChild) route = route.firstChild;
		return route.data[GONE_KEY] === true;
	}

	private absolute(path: string): string {
		return `${runtimeConfig.siteUrl.replace(/\/$/, '')}${path}`;
	}

	private setLink(rel: 'canonical' | 'alternate', hreflang: string | null, href: string): void {
		const selector = hreflang ? `link[rel='${rel}'][hreflang='${hreflang}']` : `link[rel='${rel}']`;
		let link = this.doc.head.querySelector<HTMLLinkElement>(selector);
		if (!link) {
			link = this.doc.createElement('link');
			link.setAttribute('rel', rel);
			if (hreflang) link.setAttribute('hreflang', hreflang);
			this.doc.head.appendChild(link);
		}
		link.setAttribute('href', href);
	}
}
