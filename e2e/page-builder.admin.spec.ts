import { expect, test } from '@playwright/test';

import { withDatabase } from './database';
import { HOME_LOCK_WAIT_MS, holdHome } from './home-lock';
import { ADMIN } from './support';

/**
 * Page Builder Go Live in the admin (brief E1, E2, E3, P6, A1; build step 7) on the real screens. A layout with one
 * newsletter section is laid in the database; Go Live schedules it a year ahead with an end, the switch shows on
 * Home's schedule and is cancelled again; History lists the saved version. Everything is put back after.
 */
const LAYOUT = 'lay_e2e_golive';
const REVISION = 'rev_e2e_golive';

const section = {
	schemaVersion: 1,
	hidden: false,
	screens: { phone: true, tablet: true, computer: true },
	languages: 'all',
	from: null,
	until: null,
	look: { spaceAbove: 'none', spaceBelow: 'm', width: 'page', align: 'start', background: 'none' },
	block: null,
	id: 'news',
	type: 'newsletter',
	title: { en: 'Join the list', bn: 'তালিকায় যোগ দিন' },
	subtitle: {},
};

const settings = {
	title: { en: 'Sarees from Kolkata', bn: 'কলকাতার শাড়ি' },
	description: { en: 'Woven by hand.', bn: 'হাতে বোনা।' },
	heading: { en: 'Saha Textile', bn: 'সাহা টেক্সটাইল' },
	headingShown: false,
	shareImage: null,
};

test.describe('Page Builder Go Live (step 7)', () => {
	// Home's settings, schedule and waiting list are shared with the shop's Page Builder spec: held alone (home-lock.ts)
	// and run in order in one worker.
	test.describe.configure({ mode: 'default' });
	let releaseHome: () => void = () => undefined;
	let keptSettings: unknown = null;
	// Home's schedule and waiting list as found: Go Live with an end also adds a hand-back entry, which the cancel
	// leaves, so both are put back exactly.
	let keptSchedule: unknown = [];
	let keptPending: unknown = [];

	test.beforeAll(async () => {
		test.setTimeout(HOME_LOCK_WAIT_MS + 30_000);
		releaseHome = await holdHome('change');
		const now = new Date();
		await withDatabase(async (db) => {
			const page = await db.collection('builderPages').findOne({ _id: 'home:page' as never });
			keptSettings = page?.['settings'] ?? null;
			keptSchedule = page?.['schedule'] ?? [];
			keptPending = page?.['pending'] ?? [];
			await db.collection('builderPages').updateOne(
				{ _id: 'home:page' as never },
				{
					$setOnInsert: { pageType: 'home', target: 'page', schedule: [] },
					$set: { settings, updatedAt: now },
				},
				{ upsert: true },
			);
			await db.collection('pageLayouts').updateOne(
				{ _id: LAYOUT as never },
				{
					$set: {
						pageType: 'home',
						target: 'page',
						name: 'e2e Go Live',
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
						assetIds: [],
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
		try {
			await withDatabase(async (db) => {
				await db.collection('builderPages').updateOne({ _id: 'home:page' as never }, {
					$set: { settings: keptSettings, schedule: keptSchedule, pending: keptPending },
				} as never);
				await db.collection('pageLayoutRevisions').deleteMany({ layoutId: LAYOUT });
				await db.collection('pageLayouts').deleteOne({ _id: LAYOUT as never });
			});
		} finally {
			releaseHome();
		}
	});

	test('the checks, the speed budget, then a schedule that shows on Home and is cancelled (E1, E2, P6, A1)', async ({
		page,
	}) => {
		await page.goto(`${ADMIN}/page-builder/home/layouts/${LAYOUT}`);
		await expect(page.locator('#pb_save_state')).toBeVisible();
		await page.locator('#pb_go_live').click();
		const popup = page.locator('.modal-content');
		await expect(popup.locator('#pb_changes')).toBeVisible();
		await expect(popup.locator('#pb_checks .fm-ok').first()).toBeVisible();
		await expect(popup.locator('#pb_budget [data-budget="html"]')).toBeVisible();
		await expect(popup.locator('#pb_budget [data-budget="early_pictures"]')).toContainText('0');

		// A year ahead, ending a day later; it hands back to whatever was showing.
		const year = new Date().getFullYear() + 1;
		await popup.locator('#pb_from').fill(`${year}-03-01T10:00`);
		await popup
			.locator('#pb_until')
			.isEnabled()
			.then(async (enabled) => {
				if (enabled) await popup.locator('#pb_until').fill(`${year}-03-02T10:00`);
			});
		await expect(popup.locator('#pb_schedule_note')).toBeVisible();
		await popup.locator('#pb_go_live_confirm').click();
		await expect(page).toHaveURL(/\/page-builder\/home$/);

		const row = page.locator(`#pb_when [data-cancel="${REVISION}"]`);
		await expect(row).toBeVisible();
		await row.click();
		await page.locator('#confirm_yes_btn').click();
		await expect(page.locator(`#pb_when [data-cancel="${REVISION}"]`)).toHaveCount(0);
	});

	test('History lists the saved version with Look; Bring back is not offered for the draft itself (E3)', async ({
		page,
	}) => {
		await page.goto(`${ADMIN}/page-builder/home/layouts/${LAYOUT}`);
		await page.locator('#pb_history').click();
		const saved = page.locator('#pb_history_saved');
		await expect(saved.locator(`[data-revision="${REVISION}"]`)).toBeVisible();
		await expect(saved.locator(`[data-look="${REVISION}"]`)).toBeVisible();
		await expect(saved.locator(`[data-bring-back="${REVISION}"]`)).toHaveCount(0);
	});
});
