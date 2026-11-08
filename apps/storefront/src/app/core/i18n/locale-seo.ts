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
import { DEFAULT_LOCALE, OPEN_GRAPH_LOCALES, SUPPORTED_LOCALES, isPrivatePath, withLocale } from './locale';

const NOT_FOUND_KEY = 'notFound';

/** Stored descriptions can hold markup; a search snippet cannot. */
const plainText = (html: string): string =>
	html
		.replace(/<[^>]*>/g, ' ')
		.replace(/\s+/g, ' ')
		.trim()
		.slice(0, 160);

const GONE_KEY = 'gone';

/** One step of a page's breadcrumb trail for search engines; the home page comes first on its own. */
export interface SeoCrumb {
	name: string;
	/** Locale-free app path, e.g. `/contact-us`. */
	path: string;
}

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
 * Every public page names itself in each language, reciprocally, which is what lets a search
 * engine show the Bengali page to a Bengali searcher without the site ever redirecting on a guess.
 * Its `x-default`, the version for a searcher whose language the shop does not have, is the
 * English version of the same page, never the home page. Every page also carries `og:locale`, and
 * a public page its other languages as `og:locale:alternate`, for link previews. Private pages (account, cart, checkout, sign-in…) get `noindex` and no
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
	/** The theme's share picture, put back on every page that has none of its own. */
	private defaultImage: string | null = null;
	/** True while the description is a generated stand-in that stored head data may replace. */
	private fallbackDescription = false;

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

	/** Takes a page's structured data away when the page goes, so the next page does not inherit it. */
	removeJsonLd(id: string): void {
		this.doc.getElementById(id)?.remove();
	}

	/**
	 * Marks the page as an article for link previews (`og:type`), with its dates. Every navigation
	 * resets the type to `website` and drops the dates, so only the article page itself carries them.
	 */
	applyArticle(input: { publishedTime: string; modifiedTime: string; section?: string; tags?: string[] }): void {
		this.meta.updateTag({ property: 'og:type', content: 'article' });
		this.meta.updateTag({ property: 'article:published_time', content: input.publishedTime });
		this.meta.updateTag({ property: 'article:modified_time', content: input.modifiedTime });
		this.removeArticleTags(['article:section', 'article:tag']);
		if (input.section) this.meta.addTag({ property: 'article:section', content: input.section });
		for (const tag of input.tags ?? []) this.meta.addTag({ property: 'article:tag', content: tag });
	}

	private removeArticleTags(properties: readonly string[]): void {
		for (const property of properties) {
			this.meta.getTags(`property='${property}'`).forEach((tag) => this.meta.removeTagElement(tag));
		}
	}

	/**
	 * Marks the page as a product for link previews: `og:type product`, its price in rupees and the
	 * image's alt text. Every navigation resets these, so only the product page carries them.
	 */
	applyProduct(input: { priceINR: number; imageAlt?: string }): void {
		this.meta.updateTag({ property: 'og:type', content: 'product' });
		this.meta.updateTag({ property: 'product:price:amount', content: String(input.priceINR) });
		this.meta.updateTag({ property: 'product:price:currency', content: 'INR' });
		if (input.imageAlt) this.meta.updateTag({ property: 'og:image:alt', content: input.imageAlt });
	}

	/**
	 * Clears what the previous page said about itself, at the start of every navigation, so a page
	 * that sets less than the last one never shows the last one's description or share picture.
	 */
	resetDocument(title: string): void {
		this.doc.title = title;
		this.fallbackDescription = false;
		this.meta.removeTag("name='description'");
		this.meta.removeTag("property='og:title'");
		this.meta.removeTag("property='og:description'");
		if (this.defaultImage) this.meta.updateTag({ property: 'og:image', content: this.defaultImage });
	}

	/** The share picture for pages without their own. A page's own picture is left alone. */
	setDefaultImage(url: string): void {
		const image = this.absoluteAsset(url);
		const current = this.meta.getTag("property='og:image'")?.content;
		if (!current || current === this.defaultImage) this.meta.updateTag({ property: 'og:image', content: image });
		this.defaultImage = image;
	}

	/**
	 * A generated description for a page whose stored one is empty. It never replaces a real one,
	 * and a stored description that arrives later replaces it.
	 */
	applyFallbackDescription(description: string): void {
		if (this.meta.getTag("name='description'")?.content && !this.fallbackDescription) return;
		this.applyDocument({ description });
		this.fallbackDescription = true;
	}

	/** schema.org `BreadcrumbList` for the page: Home, then `crumbs`, each a full address. */
	applyBreadcrumbList(id: string, homeName: string, crumbs: readonly SeoCrumb[]): void {
		this.applyJsonLd(id, {
			'@context': 'https://schema.org',
			'@type': 'BreadcrumbList',
			itemListElement: [{ name: homeName, path: '/' }, ...crumbs].map((crumb, index) => ({
				'@type': 'ListItem',
				position: index + 1,
				name: crumb.name,
				item: this.absoluteUrl(crumb.path),
			})),
		});
	}

	applyDocument(input: { title?: string; description?: string; robots?: string; image?: string }): void {
		if (input.title) {
			this.doc.title = input.title;
			this.meta.updateTag({ property: 'og:title', content: input.title });
		}
		const description = input.description && plainText(input.description);
		if (description) {
			this.fallbackDescription = false;
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
		const canonical = this.absolute(withLocale(this.locale, appPath));
		this.setLink('canonical', null, canonical);
		this.meta.updateTag({ property: 'og:url', content: canonical });
		for (const locale of SUPPORTED_LOCALES) {
			this.setLink('alternate', locale, this.absolute(withLocale(locale, appPath)));
		}
		this.setLink('alternate', 'x-default', this.absolute(withLocale(DEFAULT_LOCALE, appPath)));
	}

	/** `og:locale` for this page's language; the other languages only on a page meant to be found. */
	private setOpenGraphLocales(publicPage: boolean): void {
		this.meta.updateTag({ property: 'og:locale', content: OPEN_GRAPH_LOCALES[this.locale] });
		this.meta.getTags("property='og:locale:alternate'").forEach((tag) => this.meta.removeTagElement(tag));
		if (!publicPage) return;
		for (const locale of SUPPORTED_LOCALES) {
			if (locale !== this.locale) {
				this.meta.addTag({ property: 'og:locale:alternate', content: OPEN_GRAPH_LOCALES[locale] });
			}
		}
	}

	private applyDefaults(appUrl: string): void {
		const path = appUrl.split(/[?#]/)[0] || '/';
		const notFound = this.isNotFound();
		const gone = this.isGone();
		// The address middleware may already have ruled this address gone; that answer stands.
		if (notFound && this.response && this.response.statusCode !== 410) this.response.statusCode = 404;
		if (gone && this.response) this.response.statusCode = 410;
		const hidden = notFound || gone || isPrivatePath(path);
		this.setOpenGraphLocales(!hidden);
		this.meta.updateTag({ property: 'og:type', content: 'website' });
		// X reads the Open Graph tags but needs this one to show the large picture card.
		this.meta.updateTag({ name: 'twitter:card', content: 'summary_large_image' });
		this.removeArticleTags([
			'article:published_time',
			'article:modified_time',
			'article:section',
			'article:tag',
			'product:price:amount',
			'product:price:currency',
			'og:image:alt',
		]);
		if (hidden) {
			this.meta.removeTag("property='og:url'");
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
					const current = this.meta.getTag("name='description'")?.content;
					if (route.description && (!current || this.fallbackDescription)) {
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
