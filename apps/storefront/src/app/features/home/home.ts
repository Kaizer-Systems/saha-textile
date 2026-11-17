import { isPlatformBrowser } from '@angular/common';
import { afterNextRender, Component, computed, effect, inject, PLATFORM_ID, signal, untracked } from '@angular/core';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { CarouselModule } from 'ngx-owl-carousel-o';
import { combineLatest, take } from 'rxjs';

import { readRecentViews } from '@core/catalog/recent-views';
import { LocaleSeo } from '@core/i18n/locale-seo';
import { IProduct } from '@data-access/interfaces/product.interface';
import { bannerSrc, injectBannersQuery, StorefrontBanners } from '@data-access/queries/banner.queries';
import { injectPageLayoutQuery } from '@data-access/queries/page-layout.queries';
import { injectHomeRailsQuery } from '@data-access/queries/product.queries';
import { injectVideoRailQuery } from '@data-access/queries/youtube.queries';
import { ProductService } from '@data-access/services/product.service';
import { PageLayout } from '@features/page-builder/page-layout';
import { Blog } from '@features/themes/widgets/blog/blog';
import { HomeBanner } from '@features/themes/widgets/home-banner/home-banner';
import { Newsletter } from '@features/themes/widgets/newsletter/newsletter';
import { Product } from '@features/themes/widgets/product/product';
import { blogSliderNav, heroBannerSlider, productSlider6ItemMarginNav } from '@shared/data/owl-carousel';
import { ImageLink } from '@shared/ui/image-link/image-link';
import { Title } from '@shared/ui/title/title';
import { VideoCard } from '@shared/ui/video/video-card';
import { VideoModal } from '@shared/ui/video/video-modal';

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

/** The full-width hero's slides, in the order they play. */
const HERO_FULL_SLOTS = ['main', 'slide_2', 'slide_3'];

/** The tiles beside `main` in each layout. Other layouts' banners can be live at the same time. */
const HERO_LAYOUT_TILES: Record<StorefrontBanners['heroLayout'], [string | null, string | null]> = {
	hero_full: [null, null],
	hero_main_side: ['side', null],
	hero_main_stack: ['side_top', 'side_bottom'],
	hero_center_sides: ['left', 'right'],
};

@Component({
	selector: 'app-home',
	templateUrl: './home.html',
	styleUrls: ['./home.scss'],
	imports: [
		CarouselModule,
		ImageLink,
		Title,
		Product,
		Blog,
		Newsletter,
		HomeBanner,
		TranslocoModule,
		VideoCard,
		VideoModal,
		PageLayout,
	],
})
export class Home {
	constructor() {
		// The home page's search title, description and share picture, in the page's language (sent by the server):
		// Page settings from Page Builder › Home when they have them (P3), else the shop's own words.
		const seo = inject(LocaleSeo);
		const transloco = inject(TranslocoService);
		const words = signal<{ title: string; description: string } | null>(null);
		combineLatest([
			transloco.selectTranslate('home_page_title'),
			transloco.selectTranslate('home_page_description'),
		])
			.pipe(take(1))
			.subscribe(([title, description]) => words.set({ title, description }));
		effect(() => {
			const own = words();
			if (!own) return;
			const settings = this.pageSettings();
			untracked(() =>
				seo.applyDocument({
					title: settings?.title ?? own.title,
					description: settings?.description ?? own.description,
					...(settings?.shareImageUrl ? { image: settings.shareImageUrl } : {}),
				}),
			);
		});

		// The server renderer runs this hook too, and it has no storage: the rail fills in the browser.
		const isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
		afterNextRender(() => {
			if (!isBrowser) return;
			const slugs = readRecentViews(localStorage).map((row) => row.slug);
			if (slugs.length === 0) return;
			this.productsApi.cardsFor(slugs).subscribe((cards) => this.recentRail.set(cards));
		});
	}
	private readonly productsApi = inject(ProductService);
	private readonly homeQuery = injectHomeRailsQuery();
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

	// Featured blog rail ported from Osaka's home. The blog widget fetches the newest live posts,
	// sticky ones first; no ids pins none.
	public featuredBlogs = {
		title: 'featured_blog',
		description: 'featured_blog_description',
		blog_ids: [] as string[],
	};

	private readonly bannersQuery = injectBannersQuery(() => 'home');

	/** Home's live Page Builder layout; null while the builder's switch is off or nothing is live. */
	private readonly layoutQuery = injectPageLayoutQuery(() => 'home');
	readonly builderSections = computed(() => {
		const layout = this.layoutQuery.data();
		return layout?.revisionId && layout.sections.length ? layout.sections : null;
	});
	/** Home's own settings from Page Builder (P3): they apply to the fixed page too. */
	readonly pageSettings = computed(() => this.layoutQuery.data()?.settings ?? null);

	/** The channel's latest videos for the home rail, as many as admin set to show. */
	private readonly railQuery = injectVideoRailQuery(() => 'home');
	readonly railVideos = computed(() => this.railQuery.data() ?? []);

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
		const data = this.bannersQuery.data();
		const hero = (data?.banners ?? []).filter((banner) => banner.position === 'hero');
		const slot = (name: string | null) => {
			const banner = hero.find((candidate) => candidate.slot === name);
			return banner ? { image_url: bannerSrc(banner.images.desktop), resolved: banner } : null;
		};
		const [firstTile, secondTile] = HERO_LAYOUT_TILES[data?.heroLayout ?? 'hero_full'];
		return { main_banner: slot('main'), sub_banner_1: slot(firstTile), sub_banner_2: slot(secondTile) };
	});

	/** `hero_full` slides from the API, or null when none is live. */
	readonly heroSlides = computed(() => {
		const data = this.bannersQuery.data();
		const hero = (data?.banners ?? []).filter((banner) => banner.position === 'hero');
		const slides = HERO_FULL_SLOTS.flatMap((slot) => hero.filter((banner) => banner.slot === slot));
		if (data?.heroLayout !== 'hero_full' || slides.length === 0) return null;
		return slides.map((banner) => ({ image_url: bannerSrc(banner.images.desktop), resolved: banner }));
	});

	/** The two promo banners under the hero, or null when neither is live. */
	readonly promoBanners = computed(() => {
		const promos = (this.bannersQuery.data()?.banners ?? []).filter((banner) => banner.position === 'promo_wide');
		const slot = (name: string) => {
			const banner = promos.find((candidate) => candidate.slot === name);
			return banner ? { image_url: bannerSrc(banner.images.desktop), resolved: banner } : null;
		};
		return promos.length > 0 ? { first: slot('item_1'), second: slot('item_2') } : null;
	});
}
