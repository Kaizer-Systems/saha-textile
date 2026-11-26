import type { BannerArrangement, ContentBlock, HomeHeroLayout, PageSection } from '@saha-textile/contracts';

import { todaysHomePage, type TodaysHomeTitles } from './todays-home';

/**
 * The fixed home page's section titles as the shop's language files held them on 17 Nov 2026. From a layout on,
 * they are that layout's own words, changed in the builder.
 */
export const TODAYS_HOME_TITLES: TodaysHomeTitles = {
	newArrivals: { en: 'New Arrivals', bn: 'নতুন এসেছে' },
	recentlyViewed: { en: 'Recently Viewed', bn: 'সম্প্রতি দেখেছেন' },
	bestsellers: { en: 'Bestsellers', bn: 'বেস্টসেলার' },
	featured: { en: 'Featured', bn: 'বাছাই করা' },
	onSale: { en: 'Sale', bn: 'সেল' },
	videos: { en: 'Watch on YouTube', bn: 'YouTube-এ দেখুন' },
	videosDescription: {
		en: 'New collections from our Kolkata shop, on our YouTube channel.',
		bn: 'আমাদের কলকাতার দোকানের নতুন কালেকশন, আমাদের YouTube চ্যানেলে।',
	},
	blog: { en: 'Featured Blog', bn: 'বাছাই করা ব্লগ' },
	blogDescription: {
		en: 'Uncover Intriguing Highlights in Our Featured Blog',
		bn: 'আমাদের বাছাই করা ব্লগের আকর্ষণীয় লেখাগুলি পড়ুন',
	},
	newsletter: { en: 'Join Our Newsletter', bn: 'আমাদের নিউজলেটারে যোগ দিন' },
	newsletterSubtitle: {
		en: 'New arrivals and offers, straight to your inbox',
		bn: 'নতুন পণ্য আর অফারের খবর, সরাসরি আপনার ইনবক্সে',
	},
};

/** Home's templates (Q9 A): today's home page, and the four banner arrangements Home banners offers, each as a page. */
export const HOME_TEMPLATES = [
	{ key: 'today', arrangement: null },
	{ key: 'full_width_slides', arrangement: 'hero_full' },
	{ key: 'main_side_tile', arrangement: 'hero_main_side' },
	{ key: 'main_two_stacked', arrangement: 'hero_main_stack' },
	{ key: 'centre_side_tiles', arrangement: 'hero_center_sides' },
] as const satisfies readonly { key: string; arrangement: BannerArrangement | null }[];
export type HomeTemplateKey = (typeof HOME_TEMPLATES)[number]['key'];

export const isHomeTemplate = (key: string): key is HomeTemplateKey =>
	HOME_TEMPLATES.some((template) => template.key === key);

/**
 * A template's sections (brief A1, A2). "Today's home page" is today's banners in today's arrangement. An
 * arrangement template is that arrangement's banner section, the two promo banners and today's rows; with
 * `bringPictures` (A2's switch) today's live banners fill the pieces with the same name, otherwise the pieces start
 * empty. A layout made from a template keeps its sections in place (Q8 A); the builder enforces that.
 */
export function templateSections(
	key: HomeTemplateKey,
	context: {
		banners: readonly ContentBlock[];
		heroLayout: HomeHeroLayout;
		titles?: TodaysHomeTitles;
		bringPictures: boolean;
	},
): PageSection[] {
	const titles = context.titles ?? TODAYS_HOME_TITLES;
	if (key === 'today') return todaysHomePage(context.banners, context.heroLayout, titles);
	const template = HOME_TEMPLATES.find((candidate) => candidate.key === key);
	const arrangement = template?.arrangement ?? 'hero_full';
	return todaysHomePage(context.bringPictures ? context.banners : [], arrangement, titles, {
		keepEmptyBanners: true,
	});
}
