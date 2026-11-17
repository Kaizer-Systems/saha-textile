import { expect, test } from '@playwright/test';

import { withDatabase } from './database';
import { ADMIN, API_URL, SHOP } from './support';

/**
 * One list of languages (media build step 0c) and Settings › Languages (step 0d): the API answers
 * the list, every admin switch reads it, and the page adds, switches, deletes and erases.
 *
 * The flows that change the list use a made-up Tamil row (`ta`) in the throwaway e2e database and
 * remove it afterwards, so English and বাংলা stay as every other test expects. Serial, because a
 * draft language briefly adds a button to every form.
 */

test.skip(!process.env['E2E_ADMIN_EMAIL'], 'needs `pnpm e2e:stack`');
test.describe.configure({ mode: 'serial' });

const DAY = 86_400_000;
const TAMIL = 'தமிழ்';
const ago = (days: number) => new Date(Date.now() - days * DAY);

/** Writes the made-up Tamil row straight into the e2e database. */
async function tamil(row: Record<string, unknown>): Promise<void> {
	await withDatabase(async (db) => {
		await db.collection('languages').updateOne(
			{ _id: 'ta' as never },
			{
				$set: {
					admin: false,
					shop: 'draft',
					everOn: false,
					addedAt: ago(1),
					addedBy: null,
					changedAt: null,
					changedBy: null,
					deletedAt: null,
					deletedBy: null,
					remindedAt: null,
					erasedAt: null,
					...row,
				},
			},
			{ upsert: true },
		);
	});
}

async function forgetTamil(): Promise<void> {
	await withDatabase(async (db) => {
		await db.collection('languages').deleteOne({ _id: 'ta' as never });
		await db.collection('faqEntries').deleteOne({ _id: 'faq_e2e_tamil' as never });
	});
}

test('the API answers the active languages, English first, public and cacheable', async ({ request }) => {
	const answer = await request.get(`${API_URL}/storefront/languages`, { ignoreHTTPSErrors: true });
	expect(answer.status()).toBe(200);
	expect(answer.headers()['cache-control']).toBe('public, max-age=60');
	const body = (await answer.json()) as { default: string; active: string[] };
	expect(body.default).toBe('en');
	expect(body.active[0]).toBe('en');
	expect(body.active).toContain('bn');
});

test('a form’s Language switch names each active language in its own script', async ({ page }) => {
	await page.goto(`${ADMIN}/faq/create`, { waitUntil: 'networkidle' });
	const switchButtons = page.locator('app-language-switch .btn-group > button:first-child');
	await expect(switchButtons).toHaveCount(2);
	await expect(switchButtons.nth(0)).toContainText('English');
	await expect(switchButtons.nth(1)).toContainText('বাংলা');
	const kept = await page.evaluate(() => JSON.parse(localStorage.getItem('st_admin_languages') ?? '{}'));
	expect(kept).toMatchObject({ content: ['en', 'bn'], admin: ['en', 'bn'], shop: ['en', 'bn'] });
});

test('the header’s page-language menu lists each language in its own name', async ({ page }) => {
	await page.goto(`${ADMIN}/dashboard`, { waitUntil: 'networkidle' });
	const items = page.locator('.translate-btn .profile-dropdown li span');
	await expect(items).toHaveText(['English', 'বাংলা']);
	await page.locator('.page-header [title="Language"]').first().click();
	await items.nth(1).click();
	await expect(page.locator('html')).toHaveAttribute('lang', 'bn');
	// In a Bengali admin each language keeps its own name: English stays "English".
	await page.goto(`${ADMIN}/faq/create`, { waitUntil: 'networkidle' });
	await expect(page.locator('app-language-switch .btn-group > button:first-child').nth(0)).toContainText('English');
	await page.locator('.page-header [title="ভাষা"], .page-header [title="Language"]').first().click();
	await page.locator('.translate-btn .profile-dropdown li span', { hasText: 'English' }).click();
	await expect(page.locator('html')).toHaveAttribute('lang', 'en');
});

test.describe('Settings › Languages', () => {
	test.afterAll(async ({ browser }) => {
		await forgetTamil();
		// Reading the page makes the API read the list again at once.
		const page = await browser.newPage({ storageState: 'node_modules/.cache/playwright/admin-state.json' });
		await page.request.get(`${API_URL}/admin/languages/settings`, { ignoreHTTPSErrors: true });
		await page.close();
	});

	test('English is locked on, বাংলা is on, and the to-do list opens its lists filtered', async ({ page }) => {
		await page.goto(`${ADMIN}/setting/languages`, { waitUntil: 'networkidle' });
		await expect(page.locator('tr[data-language="en"] .ri-lock-line')).toBeVisible();
		await expect(page.locator('#language_admin_bn')).toBeChecked();
		await expect(page.locator('#language_shop_bn')).toBeChecked();
		const todo = await page.request.get(`${API_URL}/admin/languages/bn/todo`, { ignoreHTTPSErrors: true });
		const { total, lines } = (await todo.json()) as { total: number; lines: { area: string; count: number }[] };
		// Sixteen areas, and Page Builder since 17 Nov (page settings and live and scheduled layouts' words).
		expect(lines).toHaveLength(17);
		expect(lines.map((line) => line.area)).toContain('page_builder');
		if (!total) {
			await expect(page.locator('tr[data-language="bn"] .badge.bg-success').last()).toBeVisible();
			return;
		}
		await expect(page.locator('#language_todo_bn')).toContainText(String(total));
		await page.locator('#language_todo_bn').click();
		await expect(page.locator('.modal.show')).toContainText('What বাংলা still needs');
		const open = lines.find((line) => line.count > 0 && line.area !== 'pages' && !line.area.endsWith('_text'));
		if (!open) return;
		await page.locator(`#language_open_${open.area}`).click();
		await expect(page).toHaveURL(/missing=bn/);
		await expect(page.locator('app-missing-language-notice .alert')).toContainText('বাংলা');
		await page.locator('#missing_language_show_all').click();
		await expect(page).not.toHaveURL(/missing=/);
	});

	test('Add offers only what this release ships; বাংলা cannot be deleted while the shop shows it', async ({
		page,
	}) => {
		await page.goto(`${ADMIN}/setting/languages`, { waitUntil: 'networkidle' });
		await page.locator('#add_language_btn').click();
		await expect(page.locator('.modal.show')).toContainText('Every language in this release is already added.');
		await page.keyboard.press('Escape');
		await page.locator('#language_delete_bn').click();
		await expect(page.locator('#toast-container')).toContainText('Switch the shop off for this language first.');
	});

	test('a draft: forms write it with a Draft badge, while the admin and the shop wait for it', async ({ page }) => {
		await tamil({});
		await page.goto(`${ADMIN}/setting/languages`, { waitUntil: 'networkidle' });
		const row = page.locator('tr[data-language="ta"]');
		await expect(row).toContainText(TAMIL);
		await expect(row).toContainText('Draft');

		await page.goto(`${ADMIN}/faq/create`, { waitUntil: 'networkidle' });
		const tamilButton = page.locator('app-language-switch .btn-group > button:first-child', { hasText: TAMIL });
		await expect(tamilButton).toContainText('Draft');

		await page.goto(`${ADMIN}/setting/languages`, { waitUntil: 'networkidle' });
		// Its admin words never came with a release: the Admin switch stays off.
		const switchFor = (id: string) => page.locator('label.switch', { has: page.locator(`#${id}`) });
		await switchFor('language_admin_ta').click();
		await expect(page.locator('#toast-container')).toContainText('not complete yet');
		await expect(page.locator('#language_admin_ta')).not.toBeChecked();
		// Nothing is written in it: the Shop switch shows what is left instead.
		await switchFor('language_shop_ta').click();
		await expect(page.locator('.modal.show')).toContainText(`${TAMIL} can't go on the shop yet`);
		await page.locator('#language_dialog_confirm_btn').click();
		await expect(page.locator('.modal.show')).toContainText(`What ${TAMIL} still needs`);
		await page.locator('#language_dialog_close_btn').click();

		await page.locator('#language_delete_ta').click();
		await expect(page.locator('.modal.show')).toContainText(`Delete ${TAMIL}?`);
		await page.locator('#language_dialog_confirm_btn').click();
		await expect(page.locator('tr[data-language="ta"]')).toHaveCount(0);
		await page.goto(`${ADMIN}/faq/create`, { waitUntil: 'networkidle' });
		await expect(page.locator('app-language-switch .btn-group > button:first-child')).toHaveCount(2);
		await forgetTamil();
	});

	test('a language the shop stopped showing: 301 to English, a reminder after 30 days, and erase', async ({
		page,
		request,
	}) => {
		test.setTimeout(150_000);
		await tamil({ shop: 'off', everOn: true, deletedAt: ago(40), deletedBy: 'e2e' });
		await withDatabase(async (db) => {
			await db.collection('faqEntries').updateOne(
				{ _id: 'faq_e2e_tamil' as never },
				{
					$set: {
						question: { en: 'Do you ship abroad?', ta: 'வெளிநாடுகளுக்கு அனுப்புகிறீர்களா?' },
						answer: { en: '<p>Yes.</p>', ta: '<p>ஆம்.</p>' },
						scope: 'global',
						categoryIds: [],
						productIds: [],
						displayOrder: 999,
						status: 'draft',
					},
				},
				{ upsert: true },
			);
		});
		await page.request.get(`${API_URL}/admin/languages/settings`, { ignoreHTTPSErrors: true });

		const list = await request.get(`${API_URL}/storefront/languages`, { ignoreHTTPSErrors: true });
		expect(((await list.json()) as { redirect: string[] }).redirect).toContain('ta');
		// The shop reads the list at most once a minute.
		await expect
			.poll(
				async () => {
					const answer = await request.get(`${SHOP}/ta/faq?x=1`, {
						maxRedirects: 0,
						ignoreHTTPSErrors: true,
					});
					return [answer.status(), answer.headers()['location'], answer.headers()['cache-control']];
				},
				{ timeout: 80_000, intervals: [2_000] },
			)
			.toEqual([301, '/en/faq?x=1', 'public, max-age=3600']);

		// Deleted 40 days ago: the bell reminds whoever manages languages.
		await page.goto(`${ADMIN}/dashboard`, { waitUntil: 'networkidle' });
		const reminder = page.locator('#language_reminder_ta');
		await expect(reminder).toBeAttached();
		await reminder.evaluate((link: HTMLElement) => link.click());
		await expect(page).toHaveURL(/setting\/languages\?erase=ta/);
		await expect(page.locator('.modal.show')).toContainText(`Erase the stored ${TAMIL} text?`);
		await page.locator('#language_keep_btn').click();
		await expect(page.locator('.modal.show')).toHaveCount(0);
		await page.goto(`${ADMIN}/dashboard`, { waitUntil: 'networkidle' });
		await expect(page.locator('#language_reminder_ta')).toHaveCount(0);

		// Erase, from the popup: the name must be typed exactly.
		await page.goto(`${ADMIN}/setting/languages?erase=ta`, { waitUntil: 'networkidle' });
		await page.locator('#language_erase_input').fill('Tamil');
		await page.locator('#language_erase_btn').click();
		await expect(page.locator('.modal.show .invalid-feedback')).toContainText('exactly as shown');
		await page.locator('#language_erase_input').fill(TAMIL);
		await page.locator('#language_erase_btn').click();
		await expect(page.locator('.modal.show')).toHaveCount(0);
		const stored = await withDatabase((db) =>
			db.collection('faqEntries').findOne({ _id: 'faq_e2e_tamil' as never }),
		);
		expect(stored?.['question']).toEqual({ en: 'Do you ship abroad?' });
		expect(stored?.['answer']).toEqual({ en: '<p>Yes.</p>' });
		const audit = await withDatabase((db) =>
			db
				.collection('auditLogs')
				.findOne({ action: 'language.erase', entityId: 'ta' }, { sort: { createdAt: -1 } }),
		);
		expect(audit?.['metadata']).toMatchObject({ erasedItems: 1 });
	});
});
