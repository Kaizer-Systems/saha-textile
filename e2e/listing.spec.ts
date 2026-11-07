import { cards, expect, openFilter, showFilters, test } from './support';

test.describe('a category listing', () => {
	test.beforeEach(async ({ page }) => {
		await page.goto('/en/collections/sarees');
		await expect(cards(page).first()).toBeVisible();
		await showFilters(page);
	});

	test('narrows, widens and clears with real clicks', async ({ page, problems }) => {
		await openFilter(page, 'Fabric');
		await page.locator('label[for="facet-fabric-cotton"]').click();
		await expect(page).toHaveURL(/attribute=fabric:cotton/);

		await page.locator('label[for="facet-fabric-silk"]').click();
		await expect(page).toHaveURL(/fabric:cotton,silk/);

		await openFilter(page, 'Color');
		await page.locator('label[for="facet-color-red"]').click();
		await expect(page).toHaveURL(/color:red/);
		await expect(page.locator('.filter-category li')).toHaveCount(3);

		await page.locator('.filter-category li i.close-icon').first().click();
		await expect(page.locator('.filter-category li')).toHaveCount(2);

		await page.locator('.filter-title a').click();
		await expect(page.locator('.filter-category li')).toHaveCount(0);
		expect(problems.errors).toEqual([]);
	});

	test('keeps sibling counts while a value is ticked', async ({ page }) => {
		await openFilter(page, 'Fabric');
		const silk = page.locator('label[for="facet-fabric-silk"] .text-content');
		const before = await silk.innerText();
		await page.locator('label[for="facet-fabric-cotton"]').click();
		await expect(page).toHaveURL(/fabric:cotton/);

		await expect(silk).toHaveText(before);
	});

	test('filters by price', async ({ page }) => {
		await openFilter(page, 'Price');
		await page.locator('label[for="price-filter4"]').click();
		await expect(page).toHaveURL(/price=5000-10000/);
		await expect(cards(page).first()).toBeVisible();
	});
});

test.describe('listing addresses', () => {
	test('sorts by price', async ({ page }) => {
		await page.goto('/en/collections/sarees?sortBy=low-high');
		await expect(cards(page).first()).toContainText('Cotton Fabric');
	});

	test('opens the second page', async ({ page }) => {
		await page.goto('/en/collections/sarees?page=2');
		await expect(cards(page)).toHaveCount(25);
		await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex,follow');
	});

	test('lists everything at the top level', async ({ page }) => {
		await page.goto('/en/collections');
		await expect(cards(page)).toHaveCount(25);
	});

	for (const junk of ['page=abc', 'sortBy=nope', 'rating=9', 'price=abc', 'attribute=bad', 'category=BAD']) {
		test(`survives a hand-edited ?${junk}`, async ({ page, problems }) => {
			await page.goto(`/en/collections/sarees?${junk}`);
			await expect(cards(page)).toHaveCount(25);
			await expect(page.locator('.filter-category li')).toHaveCount(0);
			expect(problems.errors).toEqual([]);
		});
	}

	test('shows the empty message past the last page', async ({ page, problems }) => {
		await page.goto('/en/collections/sarees?page=999');
		await expect(page.locator('app-no-data')).toBeVisible();
		expect(problems.errors).toEqual([]);
	});

	test('shows the real 404 at the same address', async ({ page }) => {
		await page.goto('/en/collections/nope');
		await expect(page.locator('app-error404')).toBeVisible();
		await expect(page).toHaveURL(/\/en\/collections\/nope$/);
	});
});

test.describe('search', () => {
	test('finds products with real prices', async ({ page }) => {
		await page.goto('/en/search?search=silk');
		await expect(page.locator('app-product-box').first()).toBeVisible();
		await expect(page.locator('app-product-box').first()).not.toContainText('₹ 0.00');
	});

	test('understands a common misspelling', async ({ page }) => {
		await page.goto('/en/search?search=kanjeevaram');
		await expect(page.locator('app-product-box').first()).toContainText(/Kanjivaram|Kanchipuram/);
	});

	test('says so when nothing matches', async ({ page }) => {
		await page.goto('/en/search?search=zzzzqq');
		await expect(page.locator('app-no-data')).toBeVisible();
	});

	test('searching from the box updates the address and the results', async ({ page }) => {
		await page.goto('/en/search');
		await expect(page.locator('app-product-box').first()).toBeVisible();
		await page.waitForLoadState('networkidle');
		await page.locator('.search-box input').fill('banarasi');
		await page.locator('#search-btn:visible').click();
		await expect(page).toHaveURL(/search=banarasi/);
		await expect(page.locator('app-product-box').first()).toContainText('Banarasi');
	});
});

test('a French listing shows its filters and values in French', async ({ page }) => {
	await page.goto('/fr/collections/sarees/pure-silk/ikkat');
	await page.waitForLoadState('networkidle');
	await showFilters(page);
	await expect(page.locator('.accordion-button', { hasText: 'Tissu' }).first()).toBeVisible();
	await openFilter(page, 'Tissu');
	await expect(page.locator('body')).toContainText('Soie');
});

test('the listing comes from Meilisearch, and its counts match what a tick shows', async ({ page, request }) => {
	const api = 'https://localhost:4000/catalog/placements?path=sarees&pageSize=100';
	const all = (await (await request.get(api, { ignoreHTTPSErrors: true })).json()) as {
		total: number;
		facets: Array<{ code: string; terms: Array<{ code: string; count: number }> }>;
	};
	const facet = all.facets.find((row) => row.code === 'fabric');
	const term = facet?.terms.find((row) => row.count > 0);
	expect(term).toBeDefined();
	const ticked = await request.get(`${api}&attribute=fabric:${term?.code}`, { ignoreHTTPSErrors: true });
	const body = (await ticked.json()) as { total: number };
	expect(body.total).toBe(term?.count);
});
