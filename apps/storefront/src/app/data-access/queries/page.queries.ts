import { inject } from '@angular/core';

import { injectQuery } from '@tanstack/angular-query-experimental';
import { firstValueFrom } from 'rxjs';

import { ACTIVE_LOCALE } from '@core/i18n/active-locale';
import { IStaticPage } from '@data-access/interfaces/static-page.interface';
import { PageService } from '@data-access/services/page.service';

/**
 * TanStack Query for FAQs (replaces NGXS PageState.faq + GetFaqsAction).
 * The query's isPending() drives the skeleton (was PageService.skeletonLoader,
 * toggled by the old action). ContactUsAction was a no-op mock — dropped.
 */
export function injectFaqsQuery() {
	const pageService = inject(PageService);
	return injectQuery(() => ({
		queryKey: ['faqs'],
		queryFn: () => firstValueFrom(pageService.getFaqs()),
	}));
}

/** A single static content page (privacy policy, terms, etc.) keyed on slug.
 *  Fetches assets/data/pages/<slug>.json via PageService.getPage(). */
export function injectStaticPageQuery(slug: () => string | undefined) {
	const pageService = inject(PageService);
	const locale = inject(ACTIVE_LOCALE);
	return injectQuery(() => ({
		queryKey: ['static-page', slug(), locale],
		queryFn: (): Promise<IStaticPage> => firstValueFrom(pageService.getPage(slug()!, locale)),
		enabled: !!slug(),
		staleTime: Infinity,
	}));
}
