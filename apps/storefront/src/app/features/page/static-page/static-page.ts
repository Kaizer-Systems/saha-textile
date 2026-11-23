import { Component, DestroyRef, computed, effect, inject } from '@angular/core';
import { Router } from '@angular/router';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';

import { LocaleSeo } from '@core/i18n/locale-seo';
import { IBreadcrumb } from '@data-access/interfaces/breadcrumb';
import { injectStaticPageQuery } from '@data-access/queries/page.queries';
import { ShopDatePipe } from '@shared/pipes/shop-date.pipe';
import { Breadcrumb } from '@shared/ui/breadcrumb/breadcrumb';

const CRUMBS_JSONLD = 'page-crumbs';

/**
 * Shared presentational page for CMS-style static content (privacy policy, terms,
 * refund & returns, shipping policy). Each route re-exports this component; the
 * slug is derived from the URL (route path == JSON filename), so `/privacy-policy`
 * reads privacy-policy from the API (`GET /catalog/pages/privacy-policy`).
 *
 * Rich HTML is rendered via [innerHTML] into the theme's `.ckeditor-content`
 * wrapper — the same style used by blog detail — so no page-specific CSS is needed.
 *
 * The page's head comes from the same content: "Title | Saha Textile", its opening words as the
 * description, and a BreadcrumbList (Home › Title) for search results.
 */
@Component({
	selector: 'app-static-page',
	templateUrl: './static-page.html',
	imports: [Breadcrumb, ShopDatePipe, TranslocoModule],
})
export class StaticPage {
	private router = inject(Router);
	private seo = inject(LocaleSeo);
	private transloco = inject(TranslocoService);

	// Route path is the content slug (privacy-policy, terms-conditions, …).
	public readonly slug = this.router.url.split(/[?#]/)[0].replace(/^\/+|\/+$/g, '');

	private readonly pageQuery = injectStaticPageQuery(() => this.slug);

	public readonly content = computed(() => this.pageQuery.data()?.content ?? '');
	/** Choice 2: “Last updated” under the title, from the page's last save. */
	public readonly updatedAt = computed(() => this.pageQuery.data()?.updatedAt ?? null);
	public readonly breadcrumb = computed<IBreadcrumb | null>(() => {
		const page = this.pageQuery.data();
		return page ? { title: page.title, items: [{ label: page.title, active: true }] } : null;
	});

	constructor() {
		inject(DestroyRef).onDestroy(() => this.seo.removeJsonLd(CRUMBS_JSONLD));
		effect(() => {
			const page = this.pageQuery.data();
			if (!page) return;
			this.seo.applyDocument({
				title: page.metaTitle || `${page.title} | Saha Textile`,
				description: page.metaDescription || page.content,
			});
			this.seo.applyBreadcrumbList(CRUMBS_JSONLD, this.transloco.translate('home'), [
				{ name: page.title, path: `/${this.slug}` },
			]);
		});
	}
}
