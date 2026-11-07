import { expect, test, type Page } from '@playwright/test';

import { withDatabase } from './database';
import { ADMIN } from './support';

test.skip(!process.env['E2E_ADMIN_EMAIL'], 'needs `pnpm e2e:stack`');

async function open(page: Page, path: string): Promise<void> {
	await page.goto(`${ADMIN}${path}`);
	await page.waitForLoadState('networkidle');
}

test.describe('Admin shell', () => {
	test('the sidebar labels are real words and the title names the shop', async ({ page }) => {
		await open(page, '/dashboard');
		await expect(page).toHaveTitle(/Saha Textile/);
		const sidebar = page.locator('.sidebar-wrapper, .page-sidebar').first();
		await sidebar.getByText('Products', { exact: true }).click();
		await expect(sidebar.getByText('Measurements', { exact: true })).toBeVisible();
		await expect(sidebar.getByText('Add-on Templates', { exact: true })).toBeVisible();
	});

	test('a child row loses its highlight after leaving it', async ({ page }) => {
		await open(page, '/product');
		const sidebar = page.locator('.sidebar-wrapper, .page-sidebar').first();
		const child = sidebar.locator('a', { hasText: 'All Products' }).first();
		await expect(child).toHaveClass(/active/);
		await sidebar.getByText('Dashboard', { exact: true }).click();
		await expect(page).toHaveURL(/\/dashboard/);
		await expect(child).not.toHaveClass(/active/);
	});
});

test.describe('Screens backed by the API', () => {
	const screens: Array<[string, string]> = [
		['/product', 'Handwoven Katan Banarasi Saree'],
		['/admin-user', 'e2e-admin@example.test'],
		['/role', 'Administrator'],
		['/customer', 'example.com'],
		['/redirect', 'Redirects'],
		['/faq', 'FAQ'],
		['/qna', 'Q&A'],
		['/addon-template', 'Add-on'],
		['/media', 'Media'],
		['/review', 'Review'],
		['/setting/notifications', 'Notification'],
		['/home-banners', 'Banner'],
	];
	for (const [path, text] of screens) {
		test(`${path} loads`, async ({ page }) => {
			const failures: string[] = [];
			page.on('response', (response) => {
				if (response.status() >= 500) failures.push(`${response.status()} ${response.url()}`);
			});
			page.on('pageerror', (error) => failures.push(error.message));
			await open(page, path);
			await expect(page.locator('body')).toContainText(text, { ignoreCase: true });
			expect(failures).toEqual([]);
		});
	}
});

test.describe('Saved through the API', () => {
	test('a product edit reaches the database and survives a reload', async ({ page }) => {
		await open(page, '/product/edit/prd_906');
		await page.locator('.nav-link', { hasText: 'Inventory' }).click();
		const threshold = page.locator('#low_stock_threshold');
		await threshold.fill('7');
		await page.getByRole('button', { name: /update product/i }).click();
		await expect(page).toHaveURL(/\/product$/);

		await open(page, '/product/edit/prd_906');
		await page.locator('.nav-link', { hasText: 'Inventory' }).click();
		await expect(threshold).toHaveValue('7');
		const saved = await withDatabase((db) => db.collection('products').findOne({ _id: 'prd_906' as never }));
		expect(saved?.['lowStockThreshold']).toBe(7);
	});

	test('a redirect is created, listed, and answers on the shop', async ({ page, request }) => {
		test.setTimeout(100_000);
		const path = `/e2e-old-page-${Date.now()}`;
		await open(page, '/redirect/create');
		await page.locator('#sourcePath').fill(path);
		await page.locator('#targetPath').fill('/en/about-us');
		await page.locator('#save-redirect button, button#save-redirect').first().click();
		await expect(page).toHaveURL(/\/redirect$/);
		const saved = await withDatabase((db) => db.collection('seoRedirects').findOne({ sourcePath: path }));
		expect(saved?.['targetPath']).toBe('/en/about-us');

		// The shop refreshes its copy of the rows on a short timer, so a save shows up on the next one.
		const status = async () => (await request.get(`https://localhost:4200${path}`, { maxRedirects: 0 })).status();
		await expect.poll(status, { timeout: 70_000, intervals: [1_000] }).toBe(301);
		const answer = await request.get(`https://localhost:4200${path}`, { maxRedirects: 0 });
		expect(answer.headers()['location']).toContain('/en/about-us');
	});

	test('an answer to a product question reaches the product page', async ({ page }) => {
		const id = `q_e2e_${Date.now()}`;
		await withDatabase((db) =>
			db.collection('productQuestions').insertOne({
				_id: id as never,
				productId: 'prd_906',
				question: 'Does this come with a blouse piece?',
				askerName: 'Priya',
				answer: 'Yes, an unstitched blouse piece is included.',
				status: 'answered',
				createdAt: new Date(),
				updatedAt: new Date(),
			}),
		);
		await page.goto('https://localhost:4200/en/product/banarasi-silk-saree-color');
		await page.waitForLoadState('networkidle');
		await expect(page.locator('body')).toContainText('Does this come with a blouse piece?');
		await expect(page.locator('body')).toContainText('an unstitched blouse piece is included');
	});
});
