import { todaysHomePage, type TodaysHomeTitles } from '@saha-textile/core-domain';

import { PageLayoutModel } from '../models/index';
import { MongoContentBlockRepository } from '../repositories/content-block.repository';
import { MongoPageLayoutRepository } from '../repositories/page-layout.repository';
import { MongoSiteSettingsRepository } from '../repositories/site-settings.repository';

/** The layout's fixed id, so the step can tell it already ran and never makes a second one. */
export const TODAYS_HOME_LAYOUT_ID = 'lay_home_today';

/**
 * The fixed home page's section titles as the shop's language files held them on 17 Nov 2026 (copied, because the
 * API never reads the shop's files). From here on they are the layout's own words, changed in the builder.
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

/**
 * Migration 0005 (Page Builder, build step 2): Home's first layout, "Today's home page", made from today's live
 * home banners and fixed sections, and put on Home's schedule from now. The shop keeps drawing its fixed home page
 * until the builder's renderer is switched on, so nothing changes for shoppers. Banner records are left untouched
 * as the fallback. Safe to run again: a database that has the layout is left as it is.
 */
export async function seedTodaysHomePage(now = new Date()): Promise<string> {
	if (await PageLayoutModel.exists({ _id: TODAYS_HOME_LAYOUT_ID }).exec()) return 'Today’s home page already there';
	const banners = await new MongoContentBlockRepository().list({ ownerType: 'home' });
	const settings = await new MongoSiteSettingsRepository().get('storefront.home');
	const sections = todaysHomePage(banners, settings?.heroLayout ?? 'hero_full', TODAYS_HOME_TITLES);
	const layouts = new MongoPageLayoutRepository();
	const at = now.toISOString();
	await layouts.createLayout({
		id: TODAYS_HOME_LAYOUT_ID,
		pageType: 'home',
		target: 'page',
		name: 'Today’s home page',
		template: null,
		draftRevisionId: null,
		lastLiveRevisionId: null,
		createdAt: at,
		updatedAt: at,
		updatedBy: null,
	});
	const revision = await layouts.saveDraft({
		layoutId: TODAYS_HOME_LAYOUT_ID,
		sections,
		expectedDraftId: null,
		by: null,
		at,
	});
	if (!revision) throw new Error('Today’s home page: the first revision could not be written');
	await layouts.goLive({
		pageType: 'home',
		target: 'page',
		entry: { revisionId: revision.id, layoutId: TODAYS_HOME_LAYOUT_ID, from: at, until: null, by: null },
		at,
	});
	const pictures = sections
		.flatMap((section) => ('pieces' in section ? section.pieces : []))
		.flatMap((piece) => piece.pictures);
	return `made Today’s home page: ${sections.length} sections, ${pictures.length} banner pictures`;
}
