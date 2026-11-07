import { expect, test, type Page } from '@playwright/test';

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

	test('the first HTML never carries the box, so a returning visitor sees no flash', async ({ request }) => {
		const html = await (await request.get('/en/')).text();
		expect(html).not.toContain('cookie-bar-box');
	});

	test('refusing takes one click, is recorded, and stops optional storage', async ({ page }) => {
		await home(page);
		const saved = page.waitForResponse((row) => row.url().includes('/privacy/consent'));
		await page.locator('#cookie_necessary_btn').click();
		expect((await saved).status()).toBe(201);
		await expect(box(page)).toHaveCount(0);
		expect((await consentCookie(page))?.categories).toMatchObject({ functional: false, marketing: false });
		await page.reload();
		await expect(page.locator('app-header')).toBeVisible();
		await expect(box(page)).toHaveCount(0);
	});

	test('accepting turns on only what is in use', async ({ page }) => {
		await home(page);
		await page.locator('#cookie_accept_btn').click();
		await expect(box(page)).toHaveCount(0);
		expect((await consentCookie(page))?.categories).toMatchObject({ functional: true, analytics: false });
	});

	test('the Privacy Policy link opens in the shopper\'s language', async ({ page }) => {
		await page.goto('/fr/');
		await box(page).locator('.cookie-contain a').click();
		await expect(page).toHaveURL(/\/fr\/privacy-policy/);
		await expect(page.locator('.ckeditor-content')).toContainText('Strictement nécessaires');
	});

	test('the settings popup explains, warns, and saves a choice', async ({ page }) => {
		await home(page);
		await page.locator('#cookie_choose_btn').click();
		const popup = page.locator('.cookie-settings');
		await expect(popup.locator('.cookie-empty li')).toHaveCount(4);
		await expect(popup.locator('.cookie-effect')).toBeVisible();
		await popup.locator('.cookie-more').nth(1).click();
		await expect(popup.locator('.cookie-list li')).toHaveCount(5);
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
		if (!(await link.isVisible())) await page.locator('footer .footer-title', { hasText: 'Customer Service' }).click();
		await link.click();
		await page.locator('.cookie-settings .cookie-solid').first().click();
		expect((await consentCookie(page))?.categories.functional).toBe(false);
		expect(await page.evaluate(() => localStorage.getItem('st_recent'))).toBeNull();
	});

	test('the Contact map waits for consent, and a click shows it for this visit', async ({ page }) => {
		const google: string[] = [];
		page.on('request', (row) => {
			if (row.url().includes('google.com/maps')) google.push(row.url());
		});
		await home(page);
		await page.locator('#cookie_necessary_btn').click();
		await page.goto('/en/contact-us');
		await expect(page.locator('#show_map_btn')).toBeVisible();
		expect(google).toEqual([]);
		await page.locator('#show_map_btn').click();
		await expect(page.locator('.map-box iframe')).toHaveCount(1);
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
