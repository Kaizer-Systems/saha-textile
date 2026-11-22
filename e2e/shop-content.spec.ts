import { withDatabase } from './database';
import { API_URL, expect, test } from './support';

test.describe('Real categories', () => {
	test('the menu is in the first HTML, in the language of the page', async ({ request }) => {
		const answer = await request.get(`${API_URL}/catalog/categories/menu?locale=bn`);
		const rows = (await answer.json()) as { name: string; path: string }[];
		expect(rows.find((row) => row.path === 'sarees')?.name).toBe('শাড়ি');
		expect(await (await request.get('/bn')).text()).toContain('শাড়ি');
		expect(await (await request.get('/en')).text()).toContain('Sarees');
	});

	test('the menu links open real collections', async ({ request }) => {
		const answer = await request.get(`${API_URL}/catalog/categories/menu?locale=en`);
		const rows = (await answer.json()) as { path: string; slug: string; level: number }[];
		expect(rows.length).toBeGreaterThan(50);
		const sample = rows.find((row) => row.level === 2);
		expect((await request.get(`/en/collections/${sample?.path}`)).status()).toBe(200);
	});
});

test.describe('Bundles', () => {
	// Sets are buyable (bundle builder brief, approved 2026-11-22): the page lists their pieces and adds them to the cart.
	test('a set shows what it holds and can be added to the cart', async ({ page }) => {
		await page.goto('/en/product/wedding-saree-complete-set');
		await page.waitForLoadState('networkidle');
		await expect(page.locator('app-buy-box .st-piece-rows .st-piece').first()).toBeVisible();
		await expect(page.locator('app-buy-box')).not.toContainText('This set cannot be bought yet.');
		await expect(page.locator('[id^="addcartbtn-"]').first()).toBeVisible();
	});

	test('the cart prices a set sent by hand from its pieces', async ({ page }) => {
		await page.goto('/en');
		const answer = await page.request.post(`${API_URL}/cart/current/lines`, {
			data: { productId: 'prd_936', quantity: 1 },
		});
		expect(answer.status()).toBeLessThan(300);
		const cart = (await answer.json()) as {
			lines: { productId: string; unitPriceINR: number; children: { role: string; priceINR: number }[] }[];
		};
		const line = cart.lines.find((row) => row.productId === 'prd_936');
		const pieces = line?.children.filter((child) => child.role === 'piece') ?? [];
		expect(pieces.length).toBeGreaterThan(1);
		const shares = pieces.reduce((sum, child) => sum + child.priceINR, 0);
		expect(Math.abs(shares - (line?.unitPriceINR ?? 0))).toBeLessThan(0.05);
	});
});

test.describe.serial('Compound photos', () => {
	test.skip(({ isMobile }) => isMobile, 'changes a shared product, so this runs once');
	const slug = 'designer-saree-with-blouse';

	test('a variant with its own photos shows only those', async ({ page }) => {
		const original = await withDatabase((db) => db.collection('products').findOne({ slug }));
		const gallery = (original?.['media'] as { gallery: string[] }).gallery;
		await withDatabase((db) =>
			db.collection('products').updateOne(
				{ slug },
				{
					$set: {
						imageMode: 'compound',
						'media.compound': [
							{ selectionHash: 'color:red', gallery },
							{ selectionHash: 'color:green', gallery: gallery.slice(0, 1) },
						],
					},
				},
			),
		);
		await page.addInitScript(() => sessionStorage.setItem('st_newsletter_shown', '1'));
		try {
			await page.goto(`/en/product/${slug}?variant=BAN-1-90001`);
			await page.waitForLoadState('networkidle');
			// The photos under the main one: a plain row for up to five, the slider for more, none for a single photo
			// (product page brief P2, 21 Nov 2026). The main slider holds the same photos.
			const thumbs = page.locator(
				'.bottom-slider-image .st-thumb-row > li, .bottom-slider-image .owl-item:not(.cloned)',
			);
			const photos = page.locator('.product-main-1 .owl-item:not(.cloned)');
			await expect(photos).toHaveCount(gallery.length);
			await expect(thumbs).toHaveCount(gallery.length > 1 ? gallery.length : 0);
			await page.locator('ul.select-package.color li button').nth(1).click();
			await expect(page.locator('app-buy-box tr.active')).toContainText('Green');
			await expect(photos).toHaveCount(1);
			await expect(thumbs).toHaveCount(0);
		} finally {
			await withDatabase((db) => db.collection('products').replaceOne({ slug }, original as never));
		}
	});
});

test.describe('Browsing by category', () => {
	test('a category shows its children with counts and real links, in the first HTML', async ({ page, request }) => {
		const html = await (await request.get('/en/collections/sarees')).text();
		expect(html).toContain('category-box-list');
		await page.goto('/en/collections/sarees');
		const tiles = page.locator('.category-box-list');
		await expect(tiles).toHaveCount(7);
		await expect(tiles.first().locator('.category-name p.h6')).toContainText(/\d+/);
		// The children are the page's sections under its H1: H2s with the theme's h4 look (decision D4).
		await expect(tiles.first().locator('h2.h4')).toBeVisible();
		await expect(tiles.first().locator('img')).toHaveAttribute('src', /^https?:/);
		await expect(page.locator('app-collection-category-filter .category-list-box')).toHaveCount(7);
		await tiles.first().locator('a').first().click();
		await expect(page).toHaveURL(/\/en\/collections\/sarees\/pure-silk/);
	});

	test('a last-level category offers the categories beside it, and no filter', async ({ page }) => {
		await page.goto('/en/collections/sarees/jamdani/traditional-jamdani');
		await expect(page.locator('.category-box-list').first()).toBeVisible();
		await expect(page.locator('app-collection-category-filter')).toHaveCount(0);
	});

	test('the footer lists the top categories', async ({ page }) => {
		await page.goto('/en/');
		await expect(page.locator('footer app-footer-categories a').first()).toHaveAttribute(
			'href',
			/collections\/sarees/,
		);
	});
});

test.describe('Card names', () => {
	test('a long name shows two lines, and cards stay level', async ({ page }) => {
		await page.goto('/en/collections/sarees');
		// The card's heading (H3 under a section's H2, decision D4) keeps the theme's h6 look.
		const name = page.locator('app-product-box h3.h6.name').first();
		await expect(name).toBeVisible();
		const style = await name.evaluate((node) => {
			const css = getComputedStyle(node);
			return { clamp: css.webkitLineClamp, height: node.getBoundingClientRect().height };
		});
		expect(style.clamp).toBe('2');
		expect(style.height).toBeGreaterThan(40);
	});
});

test.describe('Theme leftovers', () => {
	test('the shop shows its own details and no placeholder art', async ({ page }) => {
		await page.goto('/en/');
		await expect(page.locator('footer')).toContainText('Barasat');
		await expect(page.locator('footer')).not.toContainText('groceries');
		await expect(page.locator('body')).not.toContainText('$20 discount');
		await expect(page.locator('img[src*="themes/denver"], img[src*="themes/berlin"]')).toHaveCount(0);
	});

	test('the header menu has no demo sections', async ({ page }) => {
		await page.goto('/en/');
		await expect(page.locator('header')).not.toContainText('Mega Menu');
	});
});
