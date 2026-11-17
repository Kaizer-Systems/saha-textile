import { SHOP, expect, test } from './support';

/** The shop reads its languages from the API (media build step 0c): menu, alternates and sitemap. */

test('the language menu lists every active language in its own name', async ({ page }) => {
	await page.goto(`${SHOP}/en/`, { waitUntil: 'networkidle' });
	const names = await page.locator('app-language .dropdown-item span').allTextContents();
	expect(names.map((name) => name.trim())).toEqual(['English', 'বাংলা']);
	await expect(page.locator('app-language .dropdown-item').nth(1)).toHaveAttribute('href', '/bn/');
});

test('a page names its other-language versions and its Open Graph languages', async ({ page }) => {
	await page.goto(`${SHOP}/bn/faq`, { waitUntil: 'domcontentloaded' });
	const alternates = await page
		.locator('link[rel="alternate"][hreflang]')
		.evaluateAll((links) => links.map((link) => link.getAttribute('hreflang')));
	expect(alternates).toEqual(expect.arrayContaining(['en', 'bn', 'x-default']));
	await expect(page.locator('meta[property="og:locale"]')).toHaveAttribute('content', 'bn_IN');
	await expect(page.locator('html')).toHaveAttribute('lang', 'bn');
});

test('the sitemap lists each page in every language', async ({ request }) => {
	const sitemap = await (await request.get(`${SHOP}/sitemap.xml`)).text();
	expect(sitemap).toContain('/en/contact-us');
	expect(sitemap).toContain('/bn/contact-us');
	expect(sitemap).toContain('hreflang="bn"');
});

test("the menu's flags are the shop's own small files, not the 161 KB country sprite", async ({ page }) => {
	const sprites: string[] = [];
	page.on('request', (request) => {
		if (/intl-tel-input|flags(@2x)?\.png/.test(request.url())) sprites.push(request.url());
	});
	await page.goto(`${SHOP}/en/`, { waitUntil: 'networkidle' });
	const flag = page.locator('app-language .iti-flag').first();
	await expect(flag).toHaveCSS('background-image', /\/assets\/images\/flags\/(us|in)\.svg/);
	// The open menu shows both languages' flags from the same files.
	const images = await page
		.locator('app-language .dropdown-item .iti-flag')
		.evaluateAll((flags) => flags.map((element) => getComputedStyle(element).backgroundImage));
	expect(images.every((image) => /\/assets\/images\/flags\/(us|in)\.svg/.test(image))).toBe(true);
	expect(sprites).toEqual([]);
});
