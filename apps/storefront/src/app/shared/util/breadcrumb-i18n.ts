import { DestroyRef, inject, Signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Title } from '@angular/platform-browser';
import { Router } from '@angular/router';

import { TranslocoService } from '@jsverse/transloco';
import { map, tap } from 'rxjs';

import { LocaleSeo } from '@core/i18n/locale-seo';
import { IBreadcrumb } from '@data-access/interfaces/breadcrumb';

const SITE_NAME = 'Saha Textile';
const CRUMBS_JSONLD = 'page-crumbs';

/** What a public page says about itself to search engines, beyond its title. */
export interface FixedPageHead {
	/** Transloco key of the page's meta description. */
	description: string;
	/** `noindex,follow` for a page that still holds stand-in content. */
	robots?: string;
	/** The page draws its own visible h1; otherwise a hidden one is written from the label. */
	ownHeading?: boolean;
}

/**
 * Option A — reactive fixed-label breadcrumb, and the page head that goes with it.
 *
 * Resolves a breadcrumb whose title/label is a STATIC UI label, from its
 * Transloco key, re-translating on runtime language switch (selectTranslate
 * without a lang re-emits on every langChanges$). Use ONLY for fixed UI labels;
 * never pass dynamic data (product/category/customer names) through here.
 *
 * Every such page gets "Label | Saha Textile" as its title. A public page passes `head`: it then
 * also gets its meta description and a schema.org BreadcrumbList (Home › Label), which is what
 * search engines show as the page's trail in results.
 *
 * A page without a visible heading of its own gets its label as a hidden main heading (h1), so
 * every page has exactly one.
 *
 * Must be called from an injection context (component field initializer or
 * constructor). Produces a single active crumb whose label matches the title,
 * which covers the auth/account pages.
 */
export function translatedBreadcrumb(titleKey: string, head?: FixedPageHead): Signal<IBreadcrumb | undefined> {
	const transloco = inject(TranslocoService);
	const applyHead = head ? publicHead(head) : titleOnly();

	return toSignal(
		transloco.selectTranslate<string>(titleKey).pipe(
			tap(applyHead),
			map((title) => ({
				title,
				items: [{ label: title, active: true }],
				...(head?.ownHeading ? {} : { hiddenHeading: true }),
			})),
		),
	);
}

/** A private page (account, cart, sign-in…): only its tab title. */
function titleOnly(): (label: string) => void {
	const title = inject(Title);
	return (label) => title.setTitle(`${label} | ${SITE_NAME}`);
}

/** A public page: title, description and its Home › Label trail for search engines. */
function publicHead(head: FixedPageHead): (label: string) => void {
	const transloco = inject(TranslocoService);
	const seo = inject(LocaleSeo);
	const path = inject(Router).url.split(/[?#]/)[0];
	inject(DestroyRef).onDestroy(() => seo.removeJsonLd(CRUMBS_JSONLD));
	return (label) => {
		seo.applyDocument({
			title: `${label} | ${SITE_NAME}`,
			description: transloco.translate(head.description),
			robots: head.robots,
		});
		seo.applyBreadcrumbList(CRUMBS_JSONLD, transloco.translate('home'), [{ name: label, path }]);
	};
}
