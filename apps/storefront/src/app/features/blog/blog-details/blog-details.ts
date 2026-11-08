import { HttpErrorResponse } from '@angular/common/http';
import { Component, DestroyRef, computed, effect, inject, signal } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { Observable } from 'rxjs';

import { LocaleSeo } from '@core/i18n/locale-seo';
import { IBlog } from '@data-access/interfaces/blog.interface';
import { IBreadcrumb } from '@data-access/interfaces/breadcrumb';
import { injectBlogBySlugQuery } from '@data-access/queries/blog.queries';
import { injectBrandQuery } from '@data-access/queries/brand.queries';
import { ShopDatePipe } from '@shared/pipes/shop-date.pipe';
import { Breadcrumb } from '@shared/ui/breadcrumb/breadcrumb';

import { BlogSidebar } from '../sidebar/sidebar';

const BRAND = 'Saha Textile';
const JSON_LD_IDS = ['blog-post', 'blog-post-crumbs'];

/**
 * A blog post: cover, title, byline and date over the article, with the left sidebar (hidden on
 * phones, owner log § blog). The page sends its own title, description, share card (`og:type`
 * article) and BlogPosting and BreadcrumbList data, in the page language.
 */
@Component({
	selector: 'app-blog-details',
	templateUrl: './blog-details.html',
	styleUrls: ['./blog-details.scss'],
	imports: [Breadcrumb, BlogSidebar, ShopDatePipe, TranslocoModule],
})
export class BlogDetails {
	private route = inject(ActivatedRoute);
	private router = inject(Router);
	private seo = inject(LocaleSeo);
	private transloco = inject(TranslocoService);
	private readonly brandQuery = injectBrandQuery();

	private readonly slug = signal<string | undefined>(undefined);
	private readonly blogQuery = injectBlogBySlugQuery(() => this.slug());
	readonly blog = computed<IBlog | undefined>(() => this.blogQuery.data());
	blog$: Observable<IBlog | undefined> = toObservable(this.blog);

	readonly breadcrumb = computed<IBreadcrumb>(() => {
		const blog = this.blog();
		const blogs = this.transloco.translate('blogs');
		return {
			title: blog?.title ?? '',
			items: [
				{ label: blogs, url: '/blogs', active: false },
				...(blog ? [{ label: blog.title, active: true }] : []),
			],
		};
	});

	constructor() {
		this.route.params.subscribe((params) => this.slug.set(params['slug']));

		// Not found only when the API says so. A server render that timed out leaves the page to the browser.
		effect(() => {
			const error = this.blogQuery.error();
			if (error instanceof HttpErrorResponse && error.status === 404) {
				void this.router.navigate(['/404'], { skipLocationChange: true });
			}
		});

		effect(() => {
			const blog = this.blog();
			if (!blog) return;
			this.applyHead(blog);
		});

		inject(DestroyRef).onDestroy(() => JSON_LD_IDS.forEach((id) => this.seo.removeJsonLd(id)));
	}

	private applyHead(blog: IBlog): void {
		const path = `/blog/${blog.slug}`;
		const image = blog.share_image ?? blog.blog_thumbnail;
		this.seo.setCanonicalPath(path);
		this.seo.applyDocument({
			title: blog.seo_title || `${blog.title} | ${BRAND}`,
			description: blog.seo_description,
			image: image?.original_url,
		});
		this.seo.applyArticle({
			publishedTime: blog.published_at,
			modifiedTime: blog.updated_at,
			section: blog.categories[0]?.name,
			tags: blog.tags.map((tag) => tag.name),
		});
		const logo = this.brandQuery.data()?.icons?.['512'];
		this.seo.applyJsonLd('blog-post', {
			'@context': 'https://schema.org',
			'@type': 'BlogPosting',
			mainEntityOfPage: { '@type': 'WebPage', '@id': this.seo.absoluteUrl(path) },
			headline: blog.title,
			description: blog.seo_description,
			...(image ? { image: [this.seo.absoluteAsset(image.original_url)] } : {}),
			datePublished: blog.published_at,
			dateModified: blog.updated_at,
			inLanguage: this.transloco.getActiveLang(),
			author: { '@type': 'Organization', name: blog.author, url: this.seo.absoluteUrl('/') },
			publisher: {
				'@type': 'Organization',
				name: BRAND,
				url: this.seo.absoluteUrl('/'),
				...(logo ? { logo: { '@type': 'ImageObject', url: this.seo.absoluteAsset(logo) } } : {}),
			},
			...(blog.categories[0] ? { articleSection: blog.categories[0].name } : {}),
			...(blog.tags.length ? { keywords: blog.tags.map((tag) => tag.name).join(', ') } : {}),
		});
		this.seo.applyJsonLd('blog-post-crumbs', {
			'@context': 'https://schema.org',
			'@type': 'BreadcrumbList',
			itemListElement: [
				{ name: this.transloco.translate('home'), path: '/' },
				{ name: this.transloco.translate('blogs'), path: '/blogs' },
				{ name: blog.title, path },
			].map((crumb, index) => ({
				'@type': 'ListItem',
				position: index + 1,
				name: crumb.name,
				item: this.seo.absoluteUrl(crumb.path),
			})),
		});
	}
}
