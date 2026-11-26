import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { connectMongo, disconnectMongo } from '../src/connection';
import { seedTodaysHomePage, TODAYS_HOME_LAYOUT_ID } from '../src/migrations/todays-home-page';
import { BuilderPageModel, ContentBlockModel, PageLayoutModel, PageLayoutRevisionModel } from '../src/models/index';
import { MongoPageLayoutRepository } from '../src/repositories/page-layout.repository';
import { hasMongoEnv } from './mongo-test-env';

describe.runIf(hasMongoEnv())('release step 0005: Today’s home page (rs0)', () => {
	const clean = async () => {
		await PageLayoutRevisionModel.deleteMany({ layoutId: TODAYS_HOME_LAYOUT_ID }).exec();
		await PageLayoutModel.deleteOne({ _id: TODAYS_HOME_LAYOUT_ID }).exec();
		await BuilderPageModel.deleteOne({ _id: 'home:page' }).exec();
	};

	beforeAll(async () => {
		await connectMongo();
		await clean();
	});
	afterAll(async () => {
		await clean();
		await disconnectMongo();
	});

	it('makes Home’s first layout from the live banners, puts it on the schedule, and runs only once', async () => {
		const liveHero = await ContentBlockModel.countDocuments({
			ownerType: 'home',
			position: 'hero',
			status: 'active',
		}).exec();
		const said = await seedTodaysHomePage(new Date('2026-11-17T07:00:00.000Z'));
		expect(said).toMatch(/^made Today’s home page: \d+ sections/);

		const layouts = new MongoPageLayoutRepository();
		const layout = await layouts.layout(TODAYS_HOME_LAYOUT_ID);
		expect(layout).toMatchObject({ pageType: 'home', target: 'page', name: 'Today’s home page', template: null });
		const revision = await layouts.revision(layout?.draftRevisionId ?? '');
		const ids = revision?.sections.map((section) => section.id) ?? [];
		expect(ids.slice(-8)).toEqual([
			'new_arrivals',
			'recently_viewed',
			'bestsellers',
			'featured',
			'on_sale',
			'videos',
			'blog',
			'newsletter',
		]);
		expect(ids.includes('hero')).toBe(liveHero > 0);
		const page = await layouts.page('home', 'page');
		expect(page?.schedule).toEqual([
			{
				revisionId: revision?.id,
				layoutId: TODAYS_HOME_LAYOUT_ID,
				from: '2026-11-17T07:00:00.000Z',
				until: null,
				by: null,
			},
		]);

		expect(await seedTodaysHomePage()).toBe('Today’s home page already there');
		expect(await PageLayoutRevisionModel.countDocuments({ layoutId: TODAYS_HOME_LAYOUT_ID }).exec()).toBe(1);
	});
});
