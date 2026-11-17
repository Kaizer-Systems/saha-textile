import { expect, test, type Page } from '@playwright/test';

import { COOKIE_POLICY_VERSION, FUNCTIONAL_ITEMS } from '../apps/storefront/src/app/core/consent/cookie-catalogue';

const box = (page: Page) => page.locator('.cookie-bar-box');
const home = async (page: Page) => {
	await page.goto('/en/');
	await expect(box(page)).toBeVisible();
};
const consentCookie = async (page: Page) => {
	const row = (await page.context().cookies()).find((cookie) => cookie.name === 'st_consent');
	return row ? (JSON.parse(decodeURIComponent(row.value)) as { categories: Record<string, boolean> }) : null;
};

test.describe('Cookie box', () => {
	test.beforeEach(async ({ page }) => {
		await page.addInitScript(() => sessionStorage.setItem('st_newsletter_shown', '1'));
	});

	test('the page carries the box hidden for everyone; its head shows it before any app script, only when undecided (D1)', async ({
		browser,
		request,
		baseURL,
	}) => {
		const html = await (await request.get('/en/')).text();
		expect(html).toMatch(/<div[^>]*class="cookie-bar-box"[^>]*\bhidden\b/);
		expect(html).toContain('st-consent-ask');
		// With every app script blocked, only the page and its head script run: the first paint as a phone sees it.
		const firstPaint = async (decided: boolean) => {
			const context = await browser.newContext({ baseURL });
			if (decided) {
				const value = encodeURIComponent(
					JSON.stringify({
						id: 'c0ffee00-0000-4000-8000-0000000000d1',
						version: COOKIE_POLICY_VERSION,
						savedAt: '2026-11-17T00:00:00.000Z',
						categories: { functional: false, analytics: false, targeting: false, marketing: false, promotional: false },
					}),
				);
				await context.addCookies([{ name: 'st_consent', value, url: baseURL ?? '' }]);
			}
			const page = await context.newPage();
			await page.route(/\.m?js(\?|$)/, (route) => route.abort());
			await page.goto('/en/', { waitUntil: 'domcontentloaded' });
			const shown = await box(page).isVisible();
			await context.close();
			return shown;
		};
		expect(await firstPaint(false)).toBe(true);
		expect(await firstPaint(true)).toBe(false);
	});

	test('refusing takes one click, is recorded, and stops optional storage', async ({ page }) => {
		await home(page);
		const saved = page.waitForResponse((row) => row.url().includes('/privacy/consent'));
		await page.locator('#cookie_necessary_btn').click();
		expect((await saved).status()).toBe(201);
		await expect(box(page)).toBeHidden();
		expect((await consentCookie(page))?.categories).toMatchObject({ functional: false, marketing: false });
		await page.reload();
		await expect(page.locator('app-header')).toBeVisible();
		await expect(box(page)).toBeHidden();
	});

	test('a tap on the box the moment the page appears still counts (D1: the box wakes on its first tap)', async ({
		page,
	}) => {
		await page.goto('/en/', { waitUntil: 'domcontentloaded' });
		await page.locator('#cookie_accept_btn').click();
		await expect(box(page)).toBeHidden();
		await expect.poll(async () => (await consentCookie(page))?.categories?.['functional']).toBe(true);
	});

	test('accepting turns on only what is in use', async ({ page }) => {
		await home(page);
		await page.locator('#cookie_accept_btn').click();
		await expect(box(page)).toBeHidden();
		expect((await consentCookie(page))?.categories).toMatchObject({ functional: true, analytics: false });
	});

	test("the Privacy Policy link opens in the shopper's language", async ({ page }) => {
		await page.goto('/bn/');
		await box(page).locator('.cookie-contain a').click();
		await expect(page).toHaveURL(/\/bn\/privacy-policy/);
		await expect(page.locator('.ckeditor-content')).toContainText('একান্ত দরকারি');
	});

	test('the settings popup explains, warns, and saves a choice', async ({ page }) => {
		await home(page);
		await page.locator('#cookie_choose_btn').click();
		const popup = page.locator('.cookie-settings');
		await expect(popup.locator('.cookie-empty li')).toHaveCount(4);
		await expect(popup.locator('.cookie-effect')).toBeVisible();
		await popup.locator('.cookie-more').nth(1).click();
		await expect(popup.locator('.cookie-list li')).toHaveCount(FUNCTIONAL_ITEMS.length);
		await popup.locator('#cookie_functional_switch').check();
		await expect(popup.locator('.cookie-effect')).toHaveCount(0);
		await popup.locator('#cookie_save_btn').click();
		await expect(popup).toHaveCount(0);
		expect((await consentCookie(page))?.categories.functional).toBe(true);
	});

	test('a change of mind from the footer takes effect at once', async ({ page }) => {
		await home(page);
		await page.locator('#cookie_accept_btn').click();
		await page.evaluate(() => localStorage.setItem('st_recent', '[]'));
		const link = page.locator('#cookie_settings_link');
		// On a phone the footer lists fold away under their headings.
		if (!(await link.isVisible()))
			await page.locator('footer .footer-title', { hasText: 'Customer Service' }).click();
		await link.click();
		await page.locator('.cookie-settings .cookie-solid').first().click();
		expect((await consentCookie(page))?.categories.functional).toBe(false);
		expect(await page.evaluate(() => localStorage.getItem('st_recent'))).toBeNull();
	});

	// Contact Us shows a card per store with a link to Google Maps (owner, 2026-11-08) instead of
	// the embedded map, so a visitor's browser asks Google for nothing until they follow a link.
	test('Contact Us asks Google Maps for nothing until a store link is followed', async ({ page }) => {
		const google: string[] = [];
		page.on('request', (row) => {
			if (/google\.[a-z.]+\/maps|maps\.googleapis|maps\.app\.goo\.gl/.test(row.url())) google.push(row.url());
		});
		await home(page);
		await page.locator('#cookie_necessary_btn').click();
		await page.goto('/en/contact-us');
		await page.waitForLoadState('networkidle');
		await expect(page.locator('iframe[src*="google"]')).toHaveCount(0);
		expect(google).toEqual([]);
	});
});

test.describe('The newsletter popup', () => {
	test('waits until the cookie choice is made', async ({ page }) => {
		await home(page);
		await page.mouse.wheel(0, 6000);
		await page.waitForTimeout(800);
		await expect(page.locator('.newsletter-modal')).toHaveCount(0);
	});
});

test.describe('Every screen size', () => {
	const sizes = [
		{ width: 320, height: 620 },
		{ width: 390, height: 780 },
		{ width: 740, height: 360 },
		{ width: 768, height: 1024 },
		{ width: 1024, height: 680 },
		{ width: 1360, height: 800 },
		{ width: 1920, height: 1080 },
	];

	for (const size of sizes) {
		test(`the popup keeps its buttons inside at ${size.width} by ${size.height}`, async ({ page }) => {
			await page.setViewportSize(size);
			await page.addInitScript(() => sessionStorage.setItem('st_newsletter_shown', '1'));
			await home(page);
			await page.locator('#cookie_choose_btn').click();
			await expect(page.locator('.cookie-settings .cookie-actions')).toBeVisible();
			const measured = await page.evaluate(() => {
				const popup = document.querySelector('.cookie-settings .modal-content')?.getBoundingClientRect();
				const buttons = [...document.querySelectorAll('.cookie-actions .btn')].map((row) =>
					row.getBoundingClientRect(),
				);
				return {
					left: Math.min(...buttons.map((row) => row.left)) - (popup?.left ?? 0),
					right: (popup?.right ?? 0) - Math.max(...buttons.map((row) => row.right)),
					fits: (popup?.bottom ?? 0) <= innerHeight + 1 && (popup?.right ?? 0) <= innerWidth + 1,
					pageWide: document.documentElement.scrollWidth > innerWidth,
				};
			});
			expect(measured.left).toBeGreaterThanOrEqual(16);
			expect(measured.right).toBeGreaterThanOrEqual(16);
			expect(measured.fits).toBe(true);
			expect(measured.pageWide).toBe(false);
		});
	}

	test('on a phone the box sits above the bottom menu', async ({ page }) => {
		await page.setViewportSize({ width: 390, height: 780 });
		await page.addInitScript(() => sessionStorage.setItem('st_newsletter_shown', '1'));
		await home(page);
		const gap = await page.evaluate(() => {
			const bar = document.querySelector('.cookie-bar-box')?.getBoundingClientRect();
			const menu = document.querySelector('.mobile-menu')?.getBoundingClientRect();
			return (menu?.top ?? 0) - (bar?.bottom ?? 0);
		});
		expect(gap).toBeGreaterThanOrEqual(0);
	});
});
