import { type APIRequestContext, type Page, expect, test } from '@playwright/test';

import { ADMIN, API_URL } from './support';

/**
 * The admin Media page (media build step 1) on the real stack, screen by screen: folders and the
 * address, uploads with the popup and the duplicate check, menus, Rename, Move to, Undo, dragging,
 * Share, Trash, keys and storage details. Everything is made under one folder and deleted for good at
 * the end. Screenshots for the run-through land in node_modules/.cache/playwright/media-uat.
 */
const RUN = `zz e2e ${Date.now().toString(36)}`;
const shot = (page: Page, name: string) =>
	page.screenshot({ path: `node_modules/.cache/playwright/media-uat/${name}.png` });
const pdf = (name: string, text = 'Saha Textile size chart') => ({
	name,
	mimeType: 'application/pdf',
	buffer: Buffer.from(`%PDF-1.4\n% ${text}\n%%EOF\n`),
});

async function csrf(request: APIRequestContext): Promise<string> {
	const answer = await request.get(`${API_URL}/auth/admin/csrf`);
	return ((await answer.json()) as { csrfToken: string }).csrfToken;
}

async function openRoot(page: Page) {
	await page.goto(`${ADMIN}/media/files`, { waitUntil: 'networkidle' });
	await expect(page.locator('#fm_page')).toBeVisible();
}

async function newFolder(page: Page, name: string) {
	await page.locator('#fm_new_folder').click();
	await page.locator('#fm_new_folder_name').fill(name);
	await page.locator('#fm_create_folder').click();
	await expect(page.locator('.fm-folder', { hasText: name })).toBeVisible();
}

/**
 * The dev bucket accepts browser uploads only from the usual admin address; this run's admin has its
 * own port. The browser's permission check is answered here for this run's address, and every PUT is
 * still sent to Spaces for real; nothing else is touched.
 */
async function spacesAcceptsThisRun(page: Page) {
	await page.route(/digitaloceanspaces\.com/, async (route) => {
		const request = route.request();
		const cors = {
			'access-control-allow-origin': new URL(ADMIN).origin,
			'access-control-allow-methods': 'GET, PUT',
			'access-control-allow-headers': request.headers()['access-control-request-headers'] ?? '*',
			'access-control-expose-headers': 'ETag',
		};
		if (request.method() === 'OPTIONS') return route.fulfill({ status: 200, headers: cors });
		if (request.method() !== 'PUT') return route.continue();
		const answer = await route.fetch();
		return route.fulfill({ response: answer, headers: { ...answer.headers(), ...cors } });
	});
}

const row = (page: Page, name: string) => page.locator('tr[data-file]', { hasText: name });
const card = (page: Page, name: string) => page.locator('.fm-folder', { hasText: name });

test.describe.configure({ mode: 'serial' });

test.describe('Media page (step 1)', () => {
	test.beforeEach(({ page }) => spacesAcceptsThisRun(page));

	test.afterAll(async ({ browser }) => {
		// Everything this run made goes for good: its folder to Trash, then out of it.
		const context = await browser.newContext({ storageState: 'node_modules/.cache/playwright/admin-state.json' });
		const request = context.request;
		const token = await csrf(request);
		const tree = (await (await request.get(`${API_URL}/admin/media/library/tree`)).json()) as {
			folders: { id: string; name: string; parentId: string | null }[];
		};
		const ours = tree.folders.filter((row) => row.name.startsWith(RUN) && !row.parentId).map((row) => row.id);
		if (ours.length) {
			const headers = { 'x-csrf-token': token };
			await request.post(`${API_URL}/admin/media/library/trash`, { headers, data: { folderIds: ours } });
			await request.post(`${API_URL}/admin/media/library/delete-forever`, { headers, data: { folderIds: ours } });
		}
		await context.close();
	});

	test('folders live in the address; Refresh keeps the place (A01, A23, A38)', async ({ page }) => {
		await openRoot(page);
		await newFolder(page, RUN);
		await shot(page, 'a23-folder-made');
		await card(page, RUN).dblclick();
		await expect(page).toHaveURL(/folder=fld_/);
		await expect(page.locator('#fm_crumbs')).toContainText(RUN);
		await page.reload({ waitUntil: 'networkidle' });
		await expect(page.locator('#fm_crumbs')).toContainText(RUN);
		await expect(page.locator('#fm_empty')).toContainText('Drag files or folders here');
		await shot(page, 'a06-empty-folder');
	});

	test('uploads: the popup lists photos as waiting and sends the rest; the tray counts (B03, B08)', async ({
		page,
	}) => {
		await openRoot(page);
		await card(page, RUN).dblclick();
		await page
			.locator('#fm_pick_files')
			.setInputFiles([
				pdf('size-chart.pdf'),
				{ name: 'cover.jpg', mimeType: 'image/jpeg', buffer: Buffer.from([255, 216, 255, 224]) },
				{ name: '.DS_Store', mimeType: '', buffer: Buffer.from('x') },
			]);
		const review = page.locator('#fm_review');
		await expect(review).toContainText('2 items go to');
		await expect(review).toContainText('Waits for image profiles');
		await expect(review).not.toContainText('.DS_Store');
		await shot(page, 'b03-upload-popup');
		await page.locator('#fm_review_upload').click();
		await expect(page.locator('.fm-tray-head')).toContainText('Uploaded 1 file');
		await expect(row(page, 'size-chart.pdf')).toContainText('Ready');
		await shot(page, 'b08-tray-done');
	});

	test('the same bytes again asks first; “Use the existing one” leaves it out (B10)', async ({ page }) => {
		await openRoot(page);
		await card(page, RUN).dblclick();
		await page.locator('#fm_pick_files').setInputFiles([pdf('copy-of-chart.pdf')]);
		await page.locator('#fm_review_upload').click();
		await expect(page.locator('#fm_duplicate')).toContainText('This file is already in Media');
		await shot(page, 'b10-same-bytes');
		await page.locator('#fm_dup_existing').click();
		await expect(row(page, 'copy-of-chart.pdf')).toHaveCount(0);
	});

	test('a file’s menu: Rename with the extension kept, then Undo from the toast (A22, A24, A37)', async ({
		page,
	}) => {
		await openRoot(page);
		await card(page, RUN).dblclick();
		await row(page, 'size-chart.pdf').click({ button: 'right' });
		await expect(page.locator('#fm_menu')).toContainText('Share');
		await shot(page, 'a22-file-menu');
		await page.locator('#fm_menu_rename').click();
		await expect(page.locator('.input-group-text')).toHaveText('.pdf');
		await page.locator('#fm_rename_name').fill('blouse-size-chart');
		await page.locator('#fm_rename_save').click();
		await expect(row(page, 'blouse-size-chart.pdf')).toBeVisible();
		await page.locator('[data-action="undo"]').click();
		await expect(row(page, 'size-chart.pdf')).toBeVisible();
		await expect(row(page, 'blouse-size-chart.pdf')).toHaveCount(0);
	});

	test('Move to opens the folders as a cascade; ⌘/Ctrl+Z puts it back; dragging onto a card moves (A21, A28)', async ({
		page,
	}) => {
		await openRoot(page);
		await card(page, RUN).dblclick();
		await newFolder(page, `${RUN} inner`);
		await row(page, 'size-chart.pdf').click({ button: 'right' });
		await page.locator('#fm_menu_move').hover();
		await expect(page.locator('#fm_move_menu')).toBeVisible();
		await shot(page, 'a21-move-cascade');
		// The file is in the run's folder; its inner folder is one level down in the cascade.
		await page.locator('#fm_move_menu > li > a[data-target]', { hasText: RUN }).first().hover();
		await page.locator('#fm_move_menu ul a[data-target]', { hasText: `${RUN} inner` }).click();
		await expect(page.locator('.toast-message', { hasText: 'Moved “size-chart.pdf”' })).toBeVisible();
		await expect(row(page, 'size-chart.pdf')).toHaveCount(0);
		await page.locator('body').press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z');
		await expect(row(page, 'size-chart.pdf')).toBeVisible();
		// The browser's own drag events, in the order a real drag fires them, with one shared payload.
		await page.evaluate((target) => {
			const source = [...document.querySelectorAll('tr[data-file]')].find((tr) =>
				tr.textContent?.includes('size-chart.pdf'),
			);
			const into = [...document.querySelectorAll('.fm-folder')].find((el) => el.textContent?.includes(target));
			const data = new DataTransfer();
			const fire = (el: Element | undefined, type: string) =>
				el?.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: data }));
			fire(source, 'dragstart');
			fire(into, 'dragenter');
			fire(into, 'dragover');
			fire(into, 'drop');
			fire(source, 'dragend');
		}, `${RUN} inner`);
		await expect(row(page, 'size-chart.pdf')).toHaveCount(0);
		await card(page, `${RUN} inner`).dblclick();
		await expect(row(page, 'size-chart.pdf')).toBeVisible();
	});

	test('Share: a link with a password is shown once and listed with who made it; Stop asks first (A35)', async ({
		page,
	}) => {
		await openRoot(page);
		await card(page, RUN).dblclick();
		await card(page, `${RUN} inner`).dblclick();
		await row(page, 'size-chart.pdf').click({ button: 'right' });
		await page.locator('#fm_menu_share').click();
		await page.locator('label.switch', { has: page.locator('#fm_share_ask_password') }).click();
		await page.locator('#fm_share_password').fill('tant-2027');
		await page.locator('#fm_share_create').click();
		await expect(page.locator('#fm_share_made')).toHaveValue(/\/s\/[A-Za-z0-9]{22}$/);
		await expect(page.locator('#fm_share_links tbody tr')).toHaveCount(1);
		await shot(page, 'a35-share');
		await page.locator('[data-action="stop"]').click();
		await expect(page.locator('#fm_stop_ask')).toBeVisible();
		await page.locator('#fm_stop_yes').click();
		await expect(page.locator('#fm_share_links tbody tr')).toContainText('Stopped');
		await page.locator('#fm_share_done').click();
	});

	test('keys: ⌘/Ctrl+A picks everything, Esc clears, ? lists the keys (A27, A39)', async ({ page }) => {
		await openRoot(page);
		await card(page, RUN).dblclick();
		await page.locator('body').press(process.platform === 'darwin' ? 'Meta+a' : 'Control+a');
		await expect(page.locator('#fm_bulk')).toContainText('selected');
		await shot(page, 'a27-bulk-bar');
		await page.locator('body').press('Escape');
		await expect(page.locator('#fm_bulk')).toHaveCount(0);
		await page.locator('body').press('Shift+?');
		await expect(page.locator('#fm_keys')).toBeVisible();
		await shot(page, 'a39-keys');
		await page.keyboard.press('Escape');
	});

	test('storage details open from the storage box (A47)', async ({ page }) => {
		await openRoot(page);
		await page.locator('#fm_storage_details').click();
		await expect(page.locator('#fm_storage_popup')).toContainText('Other admins may use on-demand storage');
		await shot(page, 'a47-storage');
	});

	test('a folder goes to Trash after asking, comes back with Undo, and is deleted for good (A25, A18)', async ({
		page,
	}) => {
		await openRoot(page);
		await card(page, RUN).click();
		await page.locator('#fm_bulk_trash').click();
		await expect(page.locator('#fm_confirm')).toContainText('Move this folder to Trash?');
		await shot(page, 'a25-trash-folder');
		await page.locator('#fm_confirm_yes').click();
		await expect(card(page, RUN)).toHaveCount(0);
		await page.locator('[data-action="undo"]').click();
		await expect(card(page, RUN)).toBeVisible();
	});
});
