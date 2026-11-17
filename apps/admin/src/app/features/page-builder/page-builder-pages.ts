import { DatePipe } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { TranslocoModule } from '@jsverse/transloco';

import { type AdminBuilderPageRow, PageBuilderGateway } from '@core/page-builder/page-builder.gateway';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';
import { PluralPipe } from '@shared/pipes/language.pipes';

/** A page listed as "Later": what you would arrange there and what it needs first (brief P1). */
interface LaterPage {
	icon: string;
	name: string;
	address: string;
	now: string;
	arrange: string;
	needs: string;
}

/** The pages that join later, one at a time, each by registering its page type (brief P1, "Which pages"). */
export const LATER_PAGES: readonly LaterPage[] = [
	{
		icon: 'ri-information-line',
		name: 'pb_page_about',
		address: '/about-us',
		now: 'pb_now_about',
		arrange: 'pb_arrange_whole',
		needs: 'pb_needs_about',
	},
	{
		icon: 'ri-apps-2-line',
		name: 'pb_page_category',
		address: '/collections/…',
		now: 'pb_now_category',
		arrange: 'pb_arrange_category',
		needs: 'pb_needs_category',
	},
	{
		icon: 'ri-shirt-line',
		name: 'pb_page_product',
		address: '/product/…',
		now: 'pb_now_product',
		arrange: 'pb_arrange_product',
		needs: 'pb_needs_product',
	},
	{
		icon: 'ri-article-line',
		name: 'pb_page_blog_list',
		address: '/blogs',
		now: 'pb_now_blog_list',
		arrange: 'pb_arrange_blog_list',
		needs: 'pb_needs_blog_list',
	},
	{
		icon: 'ri-file-text-line',
		name: 'pb_page_blog_post',
		address: '/blog/…',
		now: 'pb_now_blog_post',
		arrange: 'pb_arrange_blog_post',
		needs: 'pb_needs_blog_post',
	},
	{
		icon: 'ri-youtube-line',
		name: 'pb_page_videos',
		address: '/videos',
		now: 'pb_now_videos',
		arrange: 'pb_arrange_videos',
		needs: 'pb_needs_register',
	},
	{
		icon: 'ri-customer-service-2-line',
		name: 'pb_page_contact',
		address: '/contact-us',
		now: 'pb_now_contact',
		arrange: 'pb_arrange_contact',
		needs: 'pb_needs_register',
	},
	{
		icon: 'ri-questionnaire-line',
		name: 'pb_page_faq',
		address: '/faq',
		now: 'pb_now_faq',
		arrange: 'pb_arrange_faq',
		needs: 'pb_needs_register',
	},
	{
		icon: 'ri-coupon-2-line',
		name: 'pb_page_offers',
		address: '/offer',
		now: 'pb_now_offers',
		arrange: 'pb_arrange_offers',
		needs: 'pb_needs_register',
	},
	{
		icon: 'ri-calendar-event-line',
		name: 'pb_page_events',
		address: 'pb_address_events',
		now: 'pb_now_events',
		arrange: 'pb_arrange_events',
		needs: 'pb_needs_events',
	},
];

/**
 * Store Front › Page Builder (brief P1): the pages that can have layouts. Home is ready, with what shows now and
 * the next switch; the pages that join later say what you would arrange and what each needs first.
 */
@Component({
	selector: 'app-page-builder-pages',
	templateUrl: './page-builder-pages.html',
	imports: [DatePipe, PageWrapper, PluralPipe, RouterLink, TranslocoModule],
})
export class PageBuilderPages {
	private readonly gateway = inject(PageBuilderGateway);
	readonly pages = signal<AdminBuilderPageRow[] | null>(null);
	readonly later = LATER_PAGES;

	constructor() {
		this.gateway.pages().subscribe({
			next: (rows) => this.pages.set(rows),
			error: () => this.pages.set([]),
		});
	}
}
