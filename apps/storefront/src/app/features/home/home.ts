import { isPlatformBrowser } from '@angular/common';
import { Component, PLATFORM_ID, inject } from '@angular/core';

import { CarouselModule } from 'ngx-owl-carousel-o';

import { INewsLetter } from '@data-access/interfaces/theme.interface';
import { Blog } from '@features/themes/widgets/blog/blog';
import { Newsletter } from '@features/themes/widgets/newsletter/newsletter';
import { Product } from '@features/themes/widgets/product/product';
import { blogSliderNav, heroBannerSlider, productSlider6ItemMarginNav } from '@shared/data/owl-carousel';
import { ImageLink } from '@shared/ui/image-link/image-link';
import { Title } from '@shared/ui/title/title';

/**
 * Custom home page — served at `/` (the app's default route).
 *
 * The global header (top-bar / mega-menu) and footer come from Layout, which wraps
 * the router-outlet in App — this component owns only the page BODY. The Denver blue
 * palette is applied app-wide via scss/theme-color.css; the Denver logo + dark footer
 * are selected for `/` in Layout.setLogo().
 *
 * Built up section by section from the theme widgets. Add middle sections between the
 * hero and the newsletter as we go (import the widget here, drop its <app-…> tag into
 * home.html, feed it data).
 */
@Component({
	selector: 'app-home',
	templateUrl: './home.html',
	styleUrls: ['./home.scss'],
	imports: [CarouselModule, ImageLink, Title, Product, Blog, Newsletter],
})
export class Home {
	public isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

	// Owl-carousel options for the hero (auto-advance + arrows + dots).
	public heroSlider = heroBannerSlider;

	// Product rails + blog rail carousels — nav-enabled (side arrows) variants so the
	// user gets an explicit scroll affordance. See owl-carousel.ts.
	public productSlider = productSlider6ItemMarginNav;
	public blogSlider = blogSliderNav;

	// Product rails ported from Denver's home. The theme-product widget fetches the
	// full catalogue itself (TanStack query) and filters to these ids, so we only
	// feed the same ids/titles Denver's JSON used.
	public topSellingItems = {
		title: 'Top Selling Items',
		product_ids: [906, 912, 929, 924, 901, 907, 910, 919],
	};
	public trendyFashionFinds = {
		title: 'Trendy Fashion Finds',
		product_ids: [908, 931, 933, 913, 930, 902, 905, 915],
	};
	public chicStyleSelection = {
		title: 'Chic Style Selection',
		product_ids: [934, 936, 922, 917, 923, 921, 926, 903],
	};

	// Two side-by-side promo banners (Denver's two_column_banners section).
	public twoColumnBanners = {
		banner_1: {
			image_url: 'assets/images/data/themes/berlin/2.jpg',
			redirect_link: { link: 'fashion', link_type: 'collection' },
		},
		banner_2: {
			image_url: 'assets/images/data/themes/berlin/3.jpg',
			redirect_link: { link: 'fashion', link_type: 'collection' },
		},
	};

	// Featured blog rail ported from Osaka's home. The blog widget fetches blogs
	// itself and filters to these ids.
	public featuredBlogs = {
		title: 'Featured Blog',
		description: 'Uncover Intriguing Highlights in Our Featured Blog',
		blog_ids: [24, 23, 22, 21, 20, 19],
	};

	// Hero slides — Denver full-width banner images (assets/images/data/themes/denver).
	// Same shape as the theme JSON's banner slice: image_url + redirect_link. Add,
	// remove or repoint these freely; the carousel adapts to the count.
	public heroBanners = [
		{
			image_url: 'assets/images/data/themes/denver/1.jpg',
			redirect_link: { link: 'fashion', link_type: 'collection' },
		},
		{
			image_url: 'assets/images/data/themes/denver/2.jpg',
			redirect_link: { link: 'fashion', link_type: 'collection' },
		},
		{
			image_url: 'assets/images/data/themes/denver/3.jpg',
			redirect_link: { link: 'fashion', link_type: 'collection' },
		},
	];

	// "Join our newsletter" section — same copy/image as Denver's news_letter block.
	public newsletter: INewsLetter = {
		title: 'Join Our Newsletter And Get...',
		sub_title: '$20 discount for your first order',
		image_url: 'assets/images/data/newsletter.jpg',
		status: true,
	};
}
