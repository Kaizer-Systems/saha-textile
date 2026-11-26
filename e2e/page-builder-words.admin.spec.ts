import { expect, test } from '@playwright/test';

import { withDatabase } from './database';
import { ADMIN } from './support';

/**
 * The words map in a picture's fields (Page Builder P5, SG-1) on the real builder. A photo version is laid in the
 * database already measured (the e2e stack runs no image worker): its middle-left ninth is near white and the rest
 * near black. White words sit middle left, so they fail there; the map shades the hard boxes, rings the words' box,
 * lists the colours that read, and a click applies one.
 */
const ASSET = 'med_e2e_words';
const VERSION = 'banner_keep_shape.as_is';
const LAYOUT = 'lay_e2e_words';
const REVISION = 'rev_e2e_words';

const bins = (bin: number) => ({ hist: Array.from({ length: 32 }, (_, index) => (index === bin ? 1 : 0)) });
const wordSpots = Array.from({ length: 9 }, (_, index) => bins(index === 3 ? 31 : 1));

const section = {
	schemaVersion: 1,
	hidden: false,
	screens: { phone: true, tablet: true, computer: true },
	languages: 'all',
	from: null,
	until: null,
	look: { spaceAbove: 'none', spaceBelow: 'm', width: 'page', align: 'start', background: 'none' },
	block: null,
	id: 'hero',
	type: 'banner_arrangement',
	arrangement: 'hero_full',
	phoneSides: 'below_side_by_side',
	pieces: [
		{
			name: 'main',
			pictures: [
				{
					images: { desktop: ASSET, tablet: null, phone: null },
					localeImages: {},
					versions: { [ASSET]: VERSION },
					containsText: false,
					heading: { en: 'Made for evenings', bn: 'সন্ধ্যার জন্য' },
					subheading: {},
					ctaLabel: {},
					spot: 'middle_start',
					ink: 'white',
					backing: 'none',
					link: null,
					alt: { en: 'Saree', bn: 'শাড়ি' },
					decorative: false,
					from: null,
					until: null,
				},
			],
			slider: { seconds: 6, controls: 'bottom_center', after: 'loop' },
		},
	],
};

test.describe('the words map in the picture popup (P5)', () => {
	test.beforeAll(async () => {
		const now = new Date();
		await withDatabase(async (db) => {
			const template = await db.collection('mediaAssets').findOne({ kind: 'image', deletedAt: null });
			if (!template) throw new Error('The e2e database holds no photo to copy');
			const { _id: _ignored, ...rest } = template;
			await db.collection('mediaAssets').replaceOne(
				{ _id: ASSET as never },
				{
					...rest,
					slug: 'e2e-words',
					processing: { ...(rest['processing'] as object), state: 'ready' },
					versions: [
						{
							id: VERSION,
							profileKey: 'banner_keep_shape',
							profileVersion: 1,
							fill: 'as_is',
							state: 'ready',
							wordSpots,
							createdAt: now,
						},
					],
					derivatives: [
						{
							role: 'banner',
							storageKey: `media/${ASSET}/e2e-words-960w.webp`,
							width: 960,
							height: 400,
							byteSize: 0,
							format: 'image/webp',
							roleVersion: 1,
							versionId: VERSION,
						},
					],
				},
				{ upsert: true },
			);
			await db.collection('pageLayouts').updateOne(
				{ _id: LAYOUT as never },
				{
					$set: {
						pageType: 'home',
						target: 'page',
						name: 'e2e words map',
						template: null,
						draftRevisionId: REVISION,
						lastLiveRevisionId: null,
						revisionCount: 1,
						reviewRequest: null,
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
						sections: [section],
						assetIds: [ASSET],
						createdAt: now,
						createdBy: null,
						wentLiveAt: null,
					},
				},
				{ upsert: true },
			);
		});
	});

	test.afterAll(async () => {
		await withDatabase(async (db) => {
			await db.collection('pageLayoutRevisions').deleteMany({ layoutId: LAYOUT });
			await db.collection('pageLayouts').deleteOne({ _id: LAYOUT as never });
			await db.collection('mediaAssets').deleteOne({ _id: ASSET as never });
		});
	});

	test('shades where white words fail, rings their spot, and applies a colour that reads', async ({ page }) => {
		await page.goto(`${ADMIN}/page-builder/home/layouts/${LAYOUT}`);
		await expect(page.locator('#pb_save_state')).toBeVisible();
		await page.getByTitle("This picture's words and link").first().click();
		const map = page.locator('#pb_words_map');
		await expect(map).toBeVisible();
		// The colour and backing selects show what is stored (not their first option).
		await expect(page.locator('#pb_ink')).toHaveValue('white');
		await expect(page.locator('#pb_backing')).toHaveValue('none');

		// The computer version and, without a phone version, the same picture for phones.
		await expect(map.locator('.pb-words-map')).toHaveCount(2);
		const desktop = map.locator('.pb-words-map[data-band="desktop"]');
		await expect(desktop.locator('.pb-words-cell')).toHaveCount(9);
		// Over near black, white reads everywhere but the near-white ninth, where the words sit.
		await expect(desktop.locator('.pb-words-cell.is-hard')).toHaveCount(1);
		await expect(desktop.locator('.pb-words-cell.is-here')).toHaveAttribute('data-spot', 'middle_start');
		await expect(desktop.locator('.pb-words-cell.is-hard')).toHaveAttribute('data-spot', 'middle_start');

		// The colours that read there, and the spots where white reads as it is.
		const fixes = map.locator('#pb_words_fixes [data-fix]');
		await expect(fixes.first()).toBeVisible();
		await expect(map.locator('[data-move="middle_center"]')).toBeVisible();
		const first = (await fixes.first().getAttribute('data-fix')) ?? '';
		await fixes.first().click();
		await expect(page.locator('#pb_ink')).toHaveValue(first.split('|')[0] ?? '');
		await expect(desktop.locator('.pb-words-cell.is-here.is-hard')).toHaveCount(0);
		await expect(map.locator('#pb_words_fixes')).toHaveCount(0);

		// Nothing was saved: the popup is left without Done.
		await page.locator('.modal-footer .btn-outline').click();
	});
});
