import type { Page } from '@playwright/test';

import { expect, test } from './support';

/**
 * The installable shop. `sw.js` exists only in a production build, so these skip against
 * `vite dev`; `pnpm e2e:stack` or `E2E_BASE_URL` runs them.
 */
// Server and browser behaviour, proven once (on the laptop project).
test.describe('installable app', { tag: '@desktop-only' }, () => {
	test.beforeEach(async ({ request }) => {
		const worker = await request.get('/sw.js');
		test.skip(!worker.ok(), 'needs a production build');
	});

	test('the worker file can always be replaced, and has no fetch listener', async ({ request }) => {
		const worker = await request.get('/sw.js');
		expect(worker.headers()['cache-control']).toBe('no-cache');
		expect(await worker.text()).not.toMatch(/['"`]fetch['"`]/);
	});

	test('each language has its own manifest, as one app', async ({ page, request }) => {
		await page.goto('/bn/');
		await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', '/manifest.webmanifest?lang=bn');

		const bengali = await (await request.get('/manifest.webmanifest?lang=bn')).json();
		const english = await (await request.get('/manifest.webmanifest?lang=en')).json();
		expect(bengali).toMatchObject({ start_url: '/bn/', display: 'standalone', scope: '/' });
		expect(english.start_url).toBe('/en/');
		expect(bengali.id).toBe(english.id);
		expect(bengali.name).toBeTruthy();
		for (const icon of bengali.icons) {
			const answer = await request.get(icon.src);
			expect(answer.ok()).toBe(true);
			expect(answer.headers()['content-type']).toBe('image/png');
		}
	});

	test('no request passes through the worker and nothing is stored', async ({ page }) => {
		const throughWorker: string[] = [];
		page.on('response', (response) => {
			if (response.fromServiceWorker()) throughWorker.push(response.url());
		});

		await page.goto('/en/');
		await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
		await page.reload({ waitUntil: 'networkidle' });

		expect(await page.evaluate(() => navigator.serviceWorker.controller?.state)).toBe('activated');
		expect(throughWorker).toEqual([]);
		expect(await page.evaluate(() => caches.keys())).toEqual([]);
	});
});

test.describe('Get the App', () => {
	const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Version/18.0 Mobile/15E148 Safari/604.1';
	const popup = (page: Page) => page.locator('ngb-modal-window', { has: page.locator('#install_help_close_btn') });

	/** Opens the footer's Customer Service list on a phone, where it is folded away. */
	async function footerLink(page: Page) {
		const link = page.locator('#get_the_app_footer_link');
		await link.scrollIntoViewIfNeeded();
		if (!(await link.isVisible())) await page.getByRole('heading', { name: 'Customer Service' }).click();
		await expect(link).toBeVisible();
		return link;
	}

	test('the footer link shows the general steps when the browser has no offer', async ({ page }) => {
		await page.goto('/en/');
		await (await footerLink(page)).click();
		await expect(popup(page).getByRole('heading', { name: 'Install the app' })).toBeVisible();
		await expect(popup(page).locator('li')).toHaveCount(3);
		await expect(popup(page).locator('li').first()).toHaveText("Open your browser's menu.");
		await popup(page).locator('#install_help_close_btn').click();
		await expect(popup(page)).toBeHidden();
	});

	test('a browser that offers to install gets its own prompt, not the popup', async ({ page }) => {
		await page.goto('/en/');
		const link = await footerLink(page);
		await page.evaluate(() => {
			const offer = Object.assign(new Event('beforeinstallprompt'), {
				prompt: async () => document.documentElement.setAttribute('data-prompted', 'yes'),
			});
			window.dispatchEvent(offer);
		});
		await link.click();
		await expect(page.locator('html')).toHaveAttribute('data-prompted', 'yes');
		await expect(popup(page)).toBeHidden();
	});

	test('both links are marked to hide inside the installed app', async ({ page }) => {
		await page.goto('/en/');
		await expect(page.locator('#get_the_app_top_link')).toHaveClass(/hide-when-installed/);
		await expect(page.locator('li:has(> #get_the_app_footer_link)')).toHaveClass(/hide-when-installed/);

		// Chrome cannot emulate an installed app, so this checks the rule that does the hiding.
		const rule = await page.evaluate(() => {
			const find = (rules: CSSRuleList): string | undefined => {
				for (const rule of Array.from(rules)) {
					if (rule instanceof CSSMediaRule && rule.cssText.includes('hide-when-installed'))
						return rule.conditionText;
					if (rule instanceof CSSImportRule && rule.styleSheet) {
						const found = find(rule.styleSheet.cssRules);
						if (found) return found;
					}
				}
				return undefined;
			};
			const local = Array.from(document.styleSheets).filter((sheet) => sheet.href?.startsWith(location.origin));
			return local.map((sheet) => find(sheet.cssRules)).find(Boolean);
		});
		expect(rule).toBe('(display-mode: standalone)');
	});

	// The top bar link shows at 1400 px and wider.
	test.describe('wide screens', { tag: '@desktop-only' }, () => {
		test.use({ viewport: { width: 1600, height: 900 } });

		test('the top bar link installs, and no longer goes to apple.com', async ({ page }) => {
			await page.goto('/bn/');
			const link = page.locator('#get_the_app_top_link');
			await expect(link).toHaveText('অ্যাপটি নিন');
			await expect(link.locator('i')).toHaveClass('ri-download-2-line');
			await link.click();
			await expect(popup(page).getByRole('heading', { name: 'অ্যাপ ইনস্টল করুন' })).toBeVisible();
		});
	});

	test.describe('iPhone', () => {
		test.use({ userAgent: IPHONE });

		test('shows the Add to Home Screen steps', async ({ page }) => {
			await page.goto('/en/');
			await (await footerLink(page)).click();
			await expect(popup(page).locator('li').nth(1)).toHaveText('Scroll down and tap Add to Home Screen.');
			await expect(popup(page).locator('li i.ri-share-box-line')).toBeVisible();
		});
	});
});
