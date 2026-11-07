import { withDatabase } from './database';
import { expect, test } from './support';

test.describe('Real categories', () => {
	test('the menu is in the first HTML, in the language of the page', async ({ request }) => {
		const answer = await request.get('https://localhost:4000/catalog/categories/menu?locale=fr');
		const rows = (await answer.json()) as { name: string; path: string }[];
		expect(rows.find((row) => row.path === 'sarees')?.name).toBe('Saris');
		expect(await (await request.get('/fr')).text()).toContain('Saris');
		expect(await (await request.get('/en')).text()).toContain('Sarees');
	});

	test('the menu links open real collections', async ({ request }) => {
		const answer = await request.get('https://localhost:4000/catalog/categories/menu?locale=en');
		const rows = (await answer.json()) as { path: string; slug: string; level: number }[];
		expect(rows.length).toBeGreaterThan(50);
		const sample = rows.find((row) => row.level === 2);
		expect((await request.get(`/en/collections/${sample?.path}`)).status()).toBe(200);
	});
});

test.describe('Bundles', () => {
	test('a bundle shows what it holds, and says it cannot be bought yet', async ({ page }) => {
		await page.goto('/en/product/wedding-saree-complete-set');
		await page.waitForLoadState('networkidle');
		await expect(page.locator('app-buy-box')).toContainText('This set cannot be bought yet.');
		await expect(page.locator('[id^="addcartbtn-"]')).toHaveCount(0);
		await expect(page.locator('[id^="buynowbtn-"] button, button[id^="buynowbtn-"]').first()).toBeDisabled();
	});

	test('the cart refuses a bundle sent by hand', async ({ page }) => {
		await page.goto('/en');
		const refused = await page.request.post('https://localhost:4000/cart/current/lines', {
			data: { productId: 'prd_936', quantity: 1 },
		});
		expect(refused.status()).toBe(400);
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
			const thumbs = page.locator('.bottom-slider-image .owl-item:not(.cloned)');
			await expect(thumbs).toHaveCount(gallery.length);
			await page.locator('ul.select-package.color li button').nth(1).click();
			await expect(page.locator('app-buy-box tr.active')).toContainText('Green');
			await expect(thumbs).toHaveCount(1);
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
		await expect(tiles.first().locator('h6')).toContainText(/\d+/);
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
		await expect(page.locator('footer app-footer-categories a').first()).toHaveAttribute('href', /collections\/sarees/);
	});
});

test.describe('Card names', () => {
	test('a long name shows two lines, and cards stay level', async ({ page }) => {
		await page.goto('/en/collections/sarees');
		const name = page.locator('app-product-box h6.name').first();
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
