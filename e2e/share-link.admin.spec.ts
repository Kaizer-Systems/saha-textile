import { type APIRequestContext, type Page, expect, test } from '@playwright/test';

import { API_URL, SHOP } from './support';

/**
 * The shop's share link page (media step 1.4, brief S1–S9) on the real stack: a file goes into the
 * dev bucket through the admin API, links are made for it, and each is opened on the shop.
 * Everything made here is deleted at the end.
 */
interface Made {
	assetId: string;
	csrf: string;
	/** The name Media gave it: “(1)” is added when an earlier run left one behind. */
	name: string;
}

const upload = async (
	request: APIRequestContext,
	csrf: string,
	fileName: string,
	contentType: string,
	body: Buffer,
) => {
	const presign = await request.post(`${API_URL}/admin/media/library/files/presign`, {
		headers: { 'x-csrf-token': csrf },
		data: { fileName, contentType, byteSize: body.byteLength, folderId: null },
	});
	expect(presign.ok(), await presign.text()).toBe(true);
	const answer = (await presign.json()) as {
		assetId: string;
		name: string;
		uploadUrl: string;
		headers: Record<string, string>;
	};
	const put = await request.put(answer.uploadUrl, { headers: answer.headers, data: body });
	expect(put.ok()).toBe(true);
	const done = await request.post(`${API_URL}/admin/media/library/files/${answer.assetId}/finalize`, {
		headers: { 'x-csrf-token': csrf },
		data: {},
	});
	expect(done.ok(), await done.text()).toBe(true);
	return { assetId: answer.assetId, name: answer.name };
};

const link = async (request: APIRequestContext, made: Made, data: Record<string, unknown>) => {
	const answer = await request.post(`${API_URL}/admin/media/library/files/${made.assetId}/links`, {
		headers: { 'x-csrf-token': made.csrf },
		data,
	});
	expect(answer.ok(), await answer.text()).toBe(true);
	return (await answer.json()) as { id: string; code: string };
};

const box = (page: Page) => page.locator('#share_box');

test.describe('Share link page', () => {
	let zip: Made;
	let pdf: Made;

	test.beforeAll(async ({ browser }) => {
		const context = await browser.newContext({ storageState: 'node_modules/.cache/playwright/admin-state.json' });
		const request = context.request;
		const csrf = ((await (await request.get(`${API_URL}/auth/admin/csrf`)).json()) as { csrfToken: string })
			.csrfToken;
		const bytes = Buffer.from('Saha Textile share e2e\n'.repeat(4000));
		zip = { csrf, ...(await upload(request, csrf, 'bridal-catalogue-e2e.zip', 'application/zip', bytes)) };
		const pdfBody = Buffer.from(
			'%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n',
		);
		pdf = { csrf, ...(await upload(request, csrf, 'size-chart-e2e.pdf', 'application/pdf', pdfBody)) };
		await context.close();
	});

	test.afterAll(async ({ browser }) => {
		const context = await browser.newContext({ storageState: 'node_modules/.cache/playwright/admin-state.json' });
		const ids = [zip?.assetId, pdf?.assetId].filter(Boolean);
		const headers = { 'x-csrf-token': zip?.csrf ?? '' };
		await context.request.post(`${API_URL}/admin/media/library/trash`, { headers, data: { fileIds: ids } });
		await context.request.post(`${API_URL}/admin/media/library/delete-forever`, {
			headers,
			data: { fileIds: ids },
		});
		await context.close();
	});

	test('S8: a file the browser saves downloads, the page says so, and “click here” downloads it again', async ({
		page,
	}) => {
		const made = await link(page.request, zip, { expiry: '1h', who: 'anyone' });
		const first = page.waitForEvent('download');
		// The short form admins send: it moves to the visitor's language, then the file downloads. The page hands the
		// browser to the file as soon as it can (S1), often before its own load event, so only its start is awaited.
		await page.goto(`${SHOP}/s/${made.code}`, { waitUntil: 'commit' });
		expect((await first).suggestedFilename()).toBe(zip.name);
		await expect.poll(() => new URL(page.url()).pathname).toBe(`/en/s/${made.code}`);
		await expect(box(page)).toHaveAttribute('data-view', 'downloading');
		await expect(box(page)).toContainText('Your download has started');
		await expect(box(page)).toContainText(zip.name);
		await expect(box(page)).toContainText('If your download didn’t start automatically');
		const again = page.waitForEvent('download');
		await page.locator('#share_download_again').click();
		expect((await again).suggestedFilename()).toBe(zip.name);
		await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
	});

	test('S7: a file the browser can show opens in its own viewer, from Spaces', async ({ page }) => {
		const made = await link(page.request, pdf, { expiry: '1d', who: 'anyone' });
		await page.goto(`${SHOP}/en/s/${made.code}`);
		await expect.poll(() => page.url(), { timeout: 15_000 }).toContain('digitaloceanspaces.com');
		expect(new URL(page.url()).searchParams.get('X-Amz-Expires')).toBe('300');
	});

	test('S2, S3: a password link asks, says when it was wrong, and opens with the right one (বাংলা)', async ({
		page,
	}) => {
		const made = await link(page.request, zip, { expiry: '7d', who: 'anyone', password: 'tant-2027' });
		await page.goto(`${SHOP}/bn/s/${made.code}`);
		await expect(box(page)).toHaveAttribute('data-view', 'password');
		await expect(box(page)).toContainText('এই ফাইলে পাসওয়ার্ড আছে');
		await page.locator('#share_password').fill('nope');
		await page.locator('#share_open_btn').click();
		await expect(box(page).locator('.alert-danger')).toContainText('পাসওয়ার্ডটি ঠিক নয়');
		await page.locator('#share_password').fill('tant-2027');
		const download = page.waitForEvent('download');
		await page.locator('#share_open_btn').click();
		expect((await download).suggestedFilename()).toBe(zip.name);
		await expect(box(page)).toContainText('ডাউনলোড শুরু হয়েছে');
	});

	test('S5: an admins-only link opens for a signed-in admin and nobody else', async ({ page, browser }) => {
		const made = await link(page.request, zip, { expiry: 'never', who: 'admins' });
		const download = page.waitForEvent('download');
		await page.goto(`${SHOP}/en/s/${made.code}`, { waitUntil: 'commit' });
		expect((await download).suggestedFilename()).toBe(zip.name);
		// An empty session: in this project a new context would otherwise reuse the admin's.
		const stranger = await browser.newContext({
			ignoreHTTPSErrors: true,
			storageState: { cookies: [], origins: [] },
		});
		const visitor = await stranger.newPage();
		await visitor.goto(`${SHOP}/en/s/${made.code}`);
		await expect(box(visitor)).toHaveAttribute('data-view', 'staff');
		await expect(box(visitor)).toContainText('This link is for Saha Textile staff');
		await stranger.close();
	});

	test('S6: stopped and unknown links show the not-found page, saying the link has ended', async ({ page }) => {
		const made = await link(page.request, zip, { expiry: '1h', who: 'anyone' });
		const stopped = await page.request.patch(`${API_URL}/admin/media/library/links/${made.id}`, {
			headers: { 'x-csrf-token': zip.csrf },
			data: { stop: true },
		});
		expect(stopped.ok()).toBe(true);
		for (const code of [made.code, 'AAAAAAAAAAAAAAAAAAAAAA']) {
			await page.goto(`${SHOP}/en/s/${code}`);
			await expect(page.locator('.contain-404')).toContainText('This link has expired or was stopped');
		}
	});

	test('the red alert reads in dark mode', async ({ page }) => {
		const made = await link(page.request, zip, { expiry: '1h', who: 'anyone', password: 'tant-2027' });
		await page.context().addCookies([{ name: 'st_theme', value: 'dark', url: SHOP }]);
		await page.goto(`${SHOP}/en/s/${made.code}`);
		await page.locator('#share_password').fill('nope');
		await page.locator('#share_open_btn').click();
		const alert = box(page).locator('.alert-danger');
		await expect(alert).toBeVisible();
		await expect(alert).toHaveCSS('color', 'rgb(255, 180, 171)');
		await expect(alert).toHaveCSS('background-color', 'rgb(58, 20, 22)');
	});
});
