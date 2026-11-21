import { ensureHomeBanners, withDatabase } from './database';
import { HOME_LOCK_WAIT_MS, holdHome } from './home-lock';
import { expect, test } from './support';

/**
 * Page Builder step 3 (the shop): with the `storefront.pageBuilder` switch on, Home is drawn from its live layout;
 * off, the fixed home page shows as before. The test lays a layout on Home's schedule (a three-picture hero slider
 * and a newsletter strip), checks what the shop draws, and puts everything back.
 */
const LAYOUT = 'lay_e2e_pb';
const REVISION = 'rev_e2e_pb';

const common = {
	schemaVersion: 1,
	hidden: false,
	screens: { phone: true, tablet: true, computer: true },
	languages: 'all',
	from: null,
	until: null,
	look: { spaceAbove: 'none', spaceBelow: 'm', width: 'page', align: 'start', background: 'none' },
	block: null,
};
const picture = (slot: string) => ({
	images: { desktop: `med_e2e_hero_${slot}`, tablet: null, phone: null },
	localeImages: {},
	versions: {},
	containsText: false,
	heading: { en: `Hero ${slot}`, bn: `হিরো ${slot}` },
	subheading: {},
	ctaLabel: {},
	spot: 'middle_start',
	ink: 'brand_dark',
	backing: 'none',
	link: { href: '/collections', external: false },
	alt: { en: `Saree ${slot}`, bn: `শাড়ি ${slot}` },
	decorative: false,
	from: null,
	until: null,
});
const sections = [
	{
		...common,
		id: 'hero',
		type: 'banner_arrangement',
		arrangement: 'hero_full',
		phoneSides: 'below_side_by_side',
		pieces: [
			{
				name: 'main',
				pictures: ['main', 'slide_2', 'slide_3'].map(picture),
				slider: { seconds: 15, controls: 'bottom_center', after: 'loop' },
			},
		],
	},
	{
		...common,
		id: 'news',
		type: 'newsletter',
		title: { en: 'Builder newsletter', bn: 'বিল্ডার নিউজলেটার' },
		subtitle: {},
	},
];

const setSwitch = (home: boolean) =>
	withDatabase((db) =>
		db
			.collection('siteSettings')
			.updateOne({ _id: 'storefront.pageBuilder' as never }, { $set: { value: { home } } }, { upsert: true }),
	);

test.describe('Page Builder on the shop (step 3)', () => {
	// The switch is one for the whole shop: these run in order in one worker, holding Home alone (home-lock.ts) so the
	// other project's run of this file, and every spec that reads Home, waits.
	test.describe.configure({ mode: 'default' });
	// Everything this file changes on the home page is put back after: the banners, the switch and the schedule.
	let putBackBanners: () => Promise<void> = async () => undefined;
	let keptSwitch: Record<string, unknown> | null = null;
	let releaseHome: () => void = () => undefined;
	test.beforeAll(async () => {
		test.setTimeout(HOME_LOCK_WAIT_MS + 30_000);
		releaseHome = await holdHome('change');
		putBackBanners = await ensureHomeBanners();
		keptSwitch = await withDatabase((db) =>
			db.collection('siteSettings').findOne({ _id: 'storefront.pageBuilder' as never }),
		);
		// Later than any switch already on Home's schedule (the release step puts Today's home page there when the
		// stack starts), so this layout is the one showing: the later start wins.
		const now = new Date(Date.now() - 1_000);
		await withDatabase(async (db) => {
			await db.collection('pageLayouts').updateOne(
				{ _id: LAYOUT as never },
				{
					$set: {
						pageType: 'home',
						target: 'page',
						name: 'e2e',
						template: null,
						draftRevisionId: REVISION,
						lastLiveRevisionId: REVISION,
						revisionCount: 1,
						createdAt: now,
						updatedAt: now,
						updatedBy: null,
					},
				},
				{ upsert: true },
			);
			await db.collection('pageLayoutRevisions').updateOne(
				{ _id: REVISION as never },
				{
					$set: {
						layoutId: LAYOUT,
						number: 1,
						sections,
						assetIds: [],
						createdAt: now,
						createdBy: null,
						wentLiveAt: now,
					},
				},
				{ upsert: true },
			);
			await db.collection('builderPages').updateOne(
				{ _id: 'home:page' as never },
				{
					$setOnInsert: { pageType: 'home', target: 'page' },
					$set: { updatedAt: now },
					$push: {
						schedule: { revisionId: REVISION, layoutId: LAYOUT, from: now, until: null, by: null },
					} as never,
				},
				{ upsert: true },
			);
		});
	});

	test.afterAll(async () => {
		try {
			await withDatabase(async (db) => {
				if (keptSwitch)
					await db
						.collection('siteSettings')
						.replaceOne({ _id: 'storefront.pageBuilder' as never }, keptSwitch);
				else await db.collection('siteSettings').deleteOne({ _id: 'storefront.pageBuilder' as never });
				await db
					.collection('builderPages')
					.updateOne({ _id: 'home:page' as never }, { $pull: { schedule: { layoutId: LAYOUT } } as never });
				await db.collection('pageLayoutRevisions').deleteOne({ _id: REVISION as never });
				await db.collection('pageLayouts').deleteOne({ _id: LAYOUT as never });
			});
			await putBackBanners();
		} finally {
			releaseHome();
		}
	});

	test('switch off: the fixed home page, as before', async ({ page }) => {
		await setSwitch(false);
		await page.goto('/en/');
		await expect(page.locator('h1')).toHaveCount(1);
		await expect(page.locator('[data-pb-section]')).toHaveCount(0);
	});

	test('switch on: Home is drawn from its live layout, one early picture, a slider with pause first', async ({
		page,
	}) => {
		await setSwitch(true);
		await page.goto('/en/');
		await expect(page.locator('[data-pb-section]').first()).toHaveAttribute(
			'data-pb-section',
			'banner_arrangement',
		);
		await expect(page.locator('h1')).toHaveCount(1);
		const slider = page.locator('.pb-slider');
		await expect(slider.locator('.pb-slide')).toHaveCount(3);
		// No copies: each picture and its link is in the page once.
		await expect(page.locator('.pb-slide a[href$="/collections"]')).toHaveCount(3);
		// One picture asked for early, the first slide's.
		await expect(page.locator('img[fetchpriority="high"]')).toHaveCount(1);
		await expect(slider.locator('.pb-slide').first().locator('img')).toHaveAttribute('fetchpriority', 'high');
		// Pause comes first in the pill.
		await expect(slider.locator('.pb-controls button').first()).toHaveAttribute('aria-label', 'Pause');
		await expect(page.locator('[data-pb-section="newsletter"]')).toContainText('Builder newsletter');

		// Changing slides moves nothing else on the page.
		const below = page.locator('[data-pb-section="newsletter"]');
		// Measured on the page, not the window: clicking a bar may scroll the window, which is not a layout shift.
		const top = () => below.evaluate((element) => element.getBoundingClientRect().top + window.scrollY);
		const before = await top();
		for (const n of [2, 3, 1]) {
			await slider
				.locator('.pb-bar')
				.nth(n - 1)
				.click();
			await expect(slider.locator('.pb-bar').nth(n - 1)).toHaveAttribute('aria-current', 'true');
		}
		expect(await top()).toBe(before);
	});

	test('switch on, in বাংলা: the words come in the page language', async ({ page }) => {
		await setSwitch(true);
		await page.goto('/bn/');
		await expect(page.locator('[data-pb-section="newsletter"]')).toContainText('বিল্ডার নিউজলেটার');
		await expect(page.locator('.pb-slide img').first()).toHaveAttribute('alt', 'শাড়ি main');
	});
});
