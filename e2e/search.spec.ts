import type { Page } from '@playwright/test';

import { expect, test } from './support';

/** The suggestion box under whichever search field is open. */
const box = (page: Page) => page.locator('.search-suggestion[role="listbox"]');
const rows = (page: Page) => box(page).locator('[role="option"]');
const productRows = (page: Page) => rows(page).filter({ has: page.locator('img') });

/** A shopper who has searched before, so the empty field has something to show. */
async function withHistory(page: Page, terms: string[]) {
	await page.addInitScript((saved) => {
		localStorage.setItem('st_search', JSON.stringify({ terms: saved, products: [] }));
	}, terms);
}

/** The test catalogue has no search clicks yet, so Trending is answered with real cards. */
async function withTrending(page: Page) {
	const { apiUrl } = (await (await page.request.get('/config.json')).json()) as { apiUrl: string };
	const found = (await (await page.request.get(`${apiUrl}/catalog/search?q=saree&pageSize=4`)).json()) as {
		items: unknown[];
	};
	await page.route(/\/catalog\/search\/trending/, (route) =>
		route.fulfill({ json: { kind: 'trending', items: found.items } }),
	);
}

/** The Search page field. Typing waits for hydration, or the first letters are lost. */
async function searchPage(page: Page, locale: 'en' | 'bn', query = '') {
	await page.goto(`/${locale}/search${query}`);
	await page.waitForLoadState('networkidle');
	return page.locator('.search-box input');
}

// Phones search from the bottom bar, not the header.
test.describe('the menu-bar search', { tag: '@desktop-only' }, () => {
	test('opens ready to type, suggests while typing and opens a product with the keyboard', async ({
		page,
		problems,
	}) => {
		await withTrending(page);
		await page.goto('/en/');
		await page.waitForLoadState('networkidle');
		await page.locator('.search-full-icon a.btn').click();
		const field = page.locator('.search-full input');
		await expect(field).toBeFocused();
		await expect(field).toHaveAttribute('role', 'combobox');

		// Empty field, no history: Trending.
		await expect(box(page).locator('.suggest-title')).toHaveText('Trending now');
		await expect(productRows(page)).toHaveCount(4);
		await expect(field).toHaveAttribute('aria-expanded', 'true');

		await field.pressSequentially('jamdani', { delay: 40 });
		await expect(box(page).locator('.suggest-title').first()).toHaveText('Categories');
		await expect(productRows(page).first().locator('b')).toHaveText(/jamdani/i);
		await expect(rows(page).last()).toContainText('See all results');

		await field.press('ArrowDown');
		await expect(field).toHaveAttribute('aria-activedescendant', /search-suggest-\d+-c0/);
		// Past the categories to the first product.
		const categories = await box(page).locator('[id$="-c0"], [id$="-c1"], [id$="-c2"]').count();
		for (let step = 0; step < categories; step += 1) await field.press('ArrowDown');
		const name = await productRows(page).first().locator('h5').innerText();
		const click = page.waitForRequest((request) => /\/catalog\/search\/clicks(\?|$)/.test(request.url()));
		await field.press('Enter');
		expect((await click).postDataJSON()).toMatchObject({ q: 'jamdani' });
		await expect(page).toHaveURL(/\/en\/product\//);
		await expect(page).toHaveTitle(new RegExp(name.slice(0, 12)));
		await expect(page.locator('.search-full')).not.toHaveClass(/open/);
		expect(problems.errors).toEqual([]);
	});

	test('closes on Escape and an outside click, and Enter opens the results', async ({ page }) => {
		await withHistory(page, ['cotton saree']);
		await page.goto('/en/');
		await page.waitForLoadState('networkidle');
		await page.locator('.search-full-icon a.btn').click();
		const field = page.locator('.search-full input');
		await expect(rows(page)).toHaveText(['cotton saree']);
		await field.press('Escape');
		await expect(box(page)).toHaveCount(0);
		await field.press('Escape');
		await expect(page.locator('.search-full')).not.toHaveClass(/open/);

		await page.locator('.search-full-icon a.btn').click();
		await expect(box(page)).toBeVisible();
		await page.mouse.click(10, 400);
		await expect(box(page)).toHaveCount(0);

		await field.fill('red banarasi');
		await field.press('Enter');
		await expect(page).toHaveURL(/\/en\/search\?search=red%20banarasi/);
		await expect(page.locator('.search-section p.text-content')).toContainText('Results for “red banarasi”');
	});
});

test.describe('the Search page', () => {
	test('searches on Enter, counts it, pages the results and remembers the words', async ({ page, problems }) => {
		const field = await searchPage(page, 'en');
		const committed = page.waitForRequest(
			(request) => /\/catalog\/search\?/.test(request.url()) && request.url().includes('source=page'),
		);
		await field.fill('silk');
		await field.press('Enter');
		await committed;
		await expect(page).toHaveURL(/search=silk/);
		await expect(page.locator('.search-section p.text-content')).toContainText(/Results for “silk”: \d+/);
		await expect(page.locator('.search-product')).toHaveCount(24);

		await page.locator('.custome-pagination').getByText('2', { exact: true }).click();
		await expect(page).toHaveURL(/search=silk&page=2|page=2&search=silk/);
		await expect(page.locator('.search-product').first()).toBeVisible();

		await field.fill('');
		await field.click();
		await expect(box(page).locator('.suggest-title').first()).toContainText('Recent searches');
		await expect(rows(page).first()).toHaveText('silk');
		await box(page).locator('.suggest-clear').click();
		await expect(box(page).locator('.suggest-title')).not.toContainText(['Recent searches']);
		expect(problems.errors).toEqual([]);
	});

	test('opens results from a shared link and counts a result click', async ({ page }) => {
		await searchPage(page, 'en', '?search=jamdani');
		await expect(page.locator('.search-section p.text-content')).toContainText('Results for “jamdani”');
		const click = page.waitForRequest((request) => /\/catalog\/search\/clicks(\?|$)/.test(request.url()));
		await page.locator('.search-product .product-image a').first().click();
		expect((await click).postDataJSON()).toMatchObject({ q: 'jamdani' });
		await expect(page).toHaveURL(/\/en\/product\//);
	});

	test('says nothing matched, then shows the empty results page', async ({ page }) => {
		const field = await searchPage(page, 'en');
		await field.click();
		await field.pressSequentially('zxqvbn', { delay: 40 });
		await expect(box(page).locator('.suggest-message')).toContainText('No products match “zxqvbn”');
		await field.press('Enter');
		await expect(page.locator('app-no-data')).toBeVisible();
	});

	// The test catalogue holds English titles only; Bengali words are covered where titles exist.
	test('speaks Bengali on the Bengali page', async ({ page }) => {
		await withHistory(page, ['লাল শাড়ি']);
		const field = await searchPage(page, 'bn');
		await field.click();
		await expect(box(page).locator('.suggest-title')).toContainText('সাম্প্রতিক খোঁজ');
		await expect(rows(page)).toHaveText(['লাল শাড়ি']);
		await field.pressSequentially('cotton', { delay: 40 });
		await expect(box(page).locator('.suggest-title').last()).toHaveText('পণ্য');
		await expect(rows(page).last()).toContainText('সব ফলাফল দেখুন');
		await field.press('Enter');
		await expect(page.locator('.search-section p.text-content')).toContainText('“cotton”-এর ফলাফল');
	});
});
