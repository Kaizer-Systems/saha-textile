import { DOCUMENT } from '@angular/common';
import { Injectable, inject } from '@angular/core';
import { Meta } from '@angular/platform-browser';
import { NavigationEnd, Router } from '@angular/router';

import { filter } from 'rxjs';

import { runtimeConfig } from '@core/config/runtime-config';

import { ACTIVE_LOCALE } from './active-locale';
import { SUPPORTED_LOCALES, isPrivatePath, withLocale } from './locale';

/**
 * The language-aware head of every page: canonical, `hreflang` alternates and the private-route
 * `noindex` (`DEC-I18N-ROUTES`).
 *
 * Every public page names itself in each language plus `x-default` → `/`, reciprocally, which is
 * what lets a search engine show the French page to a French searcher without the site ever
 * redirecting on a guess. Private pages (account, cart, checkout, sign-in…) get `noindex` and no
 * alternates — they are locale-prefixed so a customer stays in their language, not to be found.
 *
 * Defaults are applied on every navigation. A page that knows better — a category reached
 * through an extra placement, whose canonical is its home path — calls
 * {@link setCanonicalPath} after its data resolves.
 */
@Injectable({ providedIn: 'root' })
export class LocaleSeo {
	private doc = inject(DOCUMENT);
	private meta = inject(Meta);
	private locale = inject(ACTIVE_LOCALE);

	constructor() {
		inject(Router)
			.events.pipe(filter((event): event is NavigationEnd => event instanceof NavigationEnd))
			.subscribe((event) => this.applyDefaults(event.urlAfterRedirects));
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
		if (isPrivatePath(path)) {
			this.meta.updateTag({ name: 'robots', content: 'noindex,follow' });
			this.doc.head
				.querySelectorAll("link[rel='canonical'], link[rel='alternate'][hreflang]")
				.forEach((link) => link.remove());
			return;
		}
		this.meta.removeTag("name='robots'");
		this.setCanonicalPath(path);
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
