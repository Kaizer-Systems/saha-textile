import { TODAYS_HOME_TITLES, todaysHomePage } from '@saha-textile/core-domain';

import { PageLayoutModel } from '../models/index';
import { MongoContentBlockRepository } from '../repositories/content-block.repository';
import { MongoPageLayoutRepository } from '../repositories/page-layout.repository';
import { MongoSiteSettingsRepository } from '../repositories/site-settings.repository';

/** Home's section titles as shipped, kept in core with the templates (re-exported for the release step's users). */
export { TODAYS_HOME_TITLES };

/** The layout's fixed id, so the step can tell it already ran and never makes a second one. */
export const TODAYS_HOME_LAYOUT_ID = 'lay_home_today';

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
		reviewRequest: null,
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
