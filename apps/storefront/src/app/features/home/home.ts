import { afterNextRender, Component, computed, inject, signal } from '@angular/core';

import { injectQuery } from '@tanstack/angular-query-experimental';
import { TranslocoModule } from '@jsverse/transloco';
import { CarouselModule } from 'ngx-owl-carousel-o';
import { firstValueFrom } from 'rxjs';

import { IProduct } from '@data-access/interfaces/product.interface';
import { ProductService } from '@data-access/services/product.service';
import { readRecentViews } from '@core/catalog/recent-views';
import { bannerSrc, injectBannersQuery, StorefrontBanners } from '@data-access/queries/banner.queries';
import { Blog } from '@features/themes/widgets/blog/blog';
import { HomeBanner } from '@features/themes/widgets/home-banner/home-banner';
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
/** Admin hero layouts → the theme hero branch that already renders that arrangement. */
const HERO_LAYOUT_THEME: Record<StorefrontBanners['heroLayout'], string | null> = {
	hero_full: null,
	hero_main_side: 'berlin',
	hero_main_stack: 'paris',
	hero_center_sides: 'tokyo',
};

@Component({
	selector: 'app-home',
	templateUrl: './home.html',
	styleUrls: ['./home.scss'],
	imports: [CarouselModule, ImageLink, Title, Product, Blog, Newsletter, HomeBanner, TranslocoModule],
})
export class Home {
	constructor() {
		afterNextRender(() => {
			const slugs = readRecentViews(localStorage).map((row) => row.slug);
			if (slugs.length === 0) return;
			this.productsApi.cardsFor(slugs).subscribe((cards) => this.recentRail.set(cards));
		});
	}
	private readonly productsApi = inject(ProductService);
	private readonly homeQuery = injectQuery(() => ({
		queryKey: ['catalog', 'home'],
		queryFn: () => firstValueFrom(this.productsApi.home()),
	}));
	readonly railsLoading = computed(() => this.homeQuery.isPending());
	readonly newArrivals = computed(() => this.homeQuery.data()?.newArrivals ?? []);
	readonly bestsellers = computed(() => this.homeQuery.data()?.bestsellers ?? []);
	readonly featuredRail = computed(() => this.homeQuery.data()?.featured ?? []);
	readonly saleRail = computed(() => this.homeQuery.data()?.sale ?? []);
	readonly recentRail = signal<IProduct[]>([]);

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

	// Featured blog rail ported from Osaka's home. The blog widget fetches blogs
	// itself and filters to these ids.
	public featuredBlogs = {
		title: 'Featured Blog',
		description: 'Uncover Intriguing Highlights in Our Featured Blog',
		blog_ids: [24, 23, 22, 21, 20, 19],
	};

	private readonly bannersQuery = injectBannersQuery(() => 'home');

	/**
	 * The admin's hero (owner log § Media → Banners). `hero_full` keeps this page's carousel;
	 * the other layouts reuse the theme's own hero markup, rendered in our colours, through
	 * `app-theme-home-banner`. With no live hero banners the page starts at its first product row.
	 */
	readonly heroTheme = computed(() => {
		const data = this.bannersQuery.data();
		if (!data || !data.banners.some((banner) => banner.position === 'hero')) return null;
		return HERO_LAYOUT_THEME[data.heroLayout];
	});

	readonly heroThemeData = computed(() => {
		const hero = (this.bannersQuery.data()?.banners ?? []).filter((banner) => banner.position === 'hero');
		const slot = (...names: string[]) => {
			const banner = hero.find((candidate) => names.includes(candidate.slot));
			return banner ? { image_url: bannerSrc(banner.images.desktop), resolved: banner } : null;
		};
		return {
			main_banner: slot('main'),
			sub_banner_1: slot('side', 'side_top', 'left'),
			sub_banner_2: slot('side_bottom', 'right'),
		};
	});

	/** `hero_full` slides from the API, or null when none is live. */
	readonly heroSlides = computed(() => {
		const data = this.bannersQuery.data();
		const main = (data?.banners ?? []).filter((banner) => banner.position === 'hero' && banner.slot === 'main');
		if (data?.heroLayout !== 'hero_full' || main.length === 0) return null;
		return main.map((banner) => ({ image_url: bannerSrc(banner.images.desktop), resolved: banner }));
	});

}
