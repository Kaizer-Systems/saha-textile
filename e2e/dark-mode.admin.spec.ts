import { expect, test, type Browser, type Page } from '@playwright/test';

import { firstScreen, lowContrast, type ContrastOptions } from './colour-checks';
import { ADMIN, ADMIN_STATE, API_URL } from './support';

/**
 * The admin's light and dark modes, the same guards as the shop's `dark-mode.spec.ts`:
 *
 * 1. Dark mode is its own stylesheet, downloaded only in dark mode, applied before the first paint
 *    (`public/assets/js/theme-mode.js`) and remembered in this browser.
 * 2. Parity: every screen has the same layout in both modes. The dark stylesheet only changes
 *    colours (`apps/admin/scripts/build-dark-theme.mjs`); a size, spacing or font that differs
 *    means a dark rule leaked layout.
 * 3. Contrast: every visible piece of text on every screen, at desktop and phone size, and in the
 *    menus, lists and popups people open, reaches WCAG AA in both modes, with see-through layers
 *    blended as the eye sees them.
 */

test.skip(!process.env['E2E_ADMIN_EMAIL'], 'needs `pnpm e2e:stack`');

/** Every admin screen, signed in as the test administrator. */
const SCREENS = [
	'/dashboard',
	'/account',
	'/product',
	'/product/create',
	'/product/edit/prd_906',
	'/category',
	'/attribute',
	'/measurement',
	'/addon-template',
	'/tag',
	'/media',
	'/media/files',
	'/media?view=clean',
	'/home-banners',
	'/event',
	'/blog',
	'/page',
	'/page/edit/privacy-policy',
	'/faq',
	'/qna',
	'/review',
	'/customer',
	'/admin-user',
	'/role',
	'/redirect',
	'/search-term',
	'/storefront-setting',
	'/inbox',
	'/notification',
	'/setting',
	'/setting/brand',
	'/setting/stores',
	'/setting/mailboxes',
	'/setting/communications',
	'/setting/languages',
	'/setting/image-profiles',
	'/setting/image-profiles/edit/product_3x4',
	'/setting/image-profiles/create',
	'/attribute?missing=bn',
	'/setting/notifications',
];

/** Moving parts that differ from one load to the next whatever the mode. */
const UNSTABLE = 'ngx-loading-bar, .toast-container, #toast-container, .apexcharts-canvas';

/** The admin's contrast rule: see-through layers blended, text under a popup's backdrop skipped. */
const CONTRAST: ContrastOptions = { blend: true, skipCovered: true, skip: '' };

/** Screens also checked at phone size. */
const PHONE_SCREENS = [
	'/dashboard',
	'/product',
	'/product/edit/prd_906',
	'/media',
	'/media/files',
	'/page/edit/privacy-policy',
	'/setting/brand',
	'/auth/login',
];

const STILL =
	'*,*::before,*::after{transition:none!important;animation:none!important;caret-color:transparent!important}';

async function open(
	browser: Browser,
	mode: 'light' | 'dark',
	path: string,
	options: { signedIn?: boolean; phone?: boolean } = {},
): Promise<Page> {
	const context = await browser.newContext({
		viewport: options.phone ? { width: 390, height: 844 } : { width: 1440, height: 900 },
		ignoreHTTPSErrors: true,
		reducedMotion: 'reduce',
		storageState: options.signedIn === false ? undefined : ADMIN_STATE,
	});
	// The starting mode only: a later switch in the test is kept across reloads, as in real use.
	await context.addInitScript((value) => {
		if (!localStorage.getItem('st_admin_theme')) localStorage.setItem('st_admin_theme', value);
	}, mode);
	const page = await context.newPage();
	await page.goto(`${ADMIN}${path}`, { waitUntil: 'networkidle' });
	await page.addStyleTag({ content: STILL });
	await page.evaluate(() => document.fonts.ready);
	await settled(page);
	return page;
}

/**
 * Waits until the page stops changing: a list can swap its loading rows for its rows or its empty
 * state a moment after the network is quiet, and the two modes must be compared in the same state.
 */
async function settled(page: Page): Promise<void> {
	const shape = () =>
		page.evaluate(() => `${document.body.innerHTML.length}:${document.documentElement.scrollHeight}`);
	let before = await shape();
	for (let tries = 0; tries < 20; tries++) {
		await page.waitForTimeout(250);
		const now = await shape();
		if (now === before) return;
		before = now;
	}
}

/** Every text on the whole page, not only the first screen: the viewport grows to the content. */
async function readable(page: Page): Promise<string[]> {
	const width = page.viewportSize()?.width ?? 1440;
	const height = await page.evaluate(() => Math.min(Math.max(document.documentElement.scrollHeight, 900), 3400));
	await page.setViewportSize({ width, height });
	await page.waitForTimeout(200);
	const found = await page.evaluate(lowContrast, CONTRAST);
	return found.map(
		(issue) => `${issue.ratio} "${issue.text}" ${issue.where} | ${issue.color} on ${issue.background}`,
	);
}

/** Runs in the page: how many rules the browser parsed from the dark stylesheet. */
function darkRulesRead(): number {
	const sheet = [...document.styleSheets].find((candidate) => candidate.href?.includes('theme-dark.gen.css'));
	let count = 0;
	const walk = (rules: CSSRuleList): void => {
		for (const rule of rules) {
			count++;
			if ('cssRules' in rule) walk((rule as CSSGroupingRule).cssRules);
		}
	};
	if (sheet) walk(sheet.cssRules);
	return count;
}

/** Runs in the page: the relative lightness (0 black, 1 white) of an element's background. */
function lightness(selector: string): number {
	const element = document.querySelector(selector);
	// A missing element fails the check rather than passing it.
	if (!element) return 1;
	const [r = 255, g = 255, b = 255] = (getComputedStyle(element).backgroundColor.match(/[\d.]+/g) ?? []).map(Number);
	return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

test.describe('Admin dark mode', () => {
	test('downloads the dark stylesheet only in dark mode, and remembers the switch', async ({ browser }) => {
		const page = await open(browser, 'light', '/dashboard');
		const requested: string[] = [];
		page.on('request', (request) => requested.push(request.url()));
		await expect(page.locator('body')).not.toHaveClass(/dark-only/);
		expect(await page.locator('#theme-dark').count()).toBe(0);

		await page.locator('#mode_switch_btn').click();
		await expect(page.locator('body')).toHaveClass(/dark-only/);
		expect(requested.some((url) => url.endsWith('/assets/css/theme-dark.gen.css'))).toBe(true);
		await expect(page.locator('#mode_switch_btn')).toHaveAttribute('title', 'Switch to light');
		expect(await page.evaluate(() => localStorage.getItem('st_admin_theme'))).toBe('dark');
		// The browser read the whole file (a syntax error silently drops everything after it), and the
		// shell really is dark: header, page and cards.
		expect(await page.evaluate(darkRulesRead)).toBeGreaterThan(1000);
		expect(await page.evaluate(lightness, '.page-header .header-wrapper')).toBeLessThan(0.2);
		expect(await page.evaluate(lightness, '.page-body')).toBeLessThan(0.2);
		expect(await page.evaluate(lightness, '.page-body .card')).toBeLessThan(0.2);

		// A reload starts dark before Angular runs: the body is dark from its first paint.
		await page.goto(`${ADMIN}/dashboard`, { waitUntil: 'commit' });
		await page.waitForFunction(() => !!document.body);
		expect(await page.evaluate(() => document.body.classList.contains('dark-only'))).toBe(true);

		await page.locator('#mode_switch_btn').click();
		await expect(page.locator('body')).not.toHaveClass(/dark-only/);
		expect(await page.locator('#theme-dark').count()).toBe(0);
		await page.context().close();
	});

	test('the main stylesheet carries no dark rules', async ({ request }) => {
		const html = await (await request.get(`${ADMIN}/`, { ignoreHTTPSErrors: true })).text();
		const sheets = [...html.matchAll(/href="([^"]+\.css)"/g)].map((match) => match[1]!);
		expect(sheets.length).toBeGreaterThan(0);
		for (const sheet of sheets.filter((href) => !href.includes('theme-dark'))) {
			const css = await (await request.get(`${ADMIN}${sheet}`, { ignoreHTTPSErrors: true })).text();
			expect(css, sheet).not.toContain('.dark-only');
		}
	});

	test('sign-in is dark before anyone signs in, with the dark logo when the Brand Kit has one', async ({
		browser,
		request,
	}) => {
		const brand = (await (
			await request.get(`${API_URL}/storefront/brand`, { ignoreHTTPSErrors: true })
		).json()) as {
			admin?: { logo?: { url: string } | null; logoDark?: { url: string } | null };
		};
		const page = await open(browser, 'dark', '/auth/login', { signedIn: false });
		await expect(page.locator('body')).toHaveClass(/dark-only/);
		expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe('rgb(11, 20, 29)');
		const logo = page.locator('.log-in-title img');
		const expected = brand.admin?.logoDark?.url ?? brand.admin?.logo?.url;
		if (expected) await expect(logo).toHaveAttribute('src', expected);
		else await expect(logo).toHaveCount(0);
		await page.context().close();
	});
});

test.describe('Admin light and dark: layout and contrast on every screen', () => {
	for (const path of [...SCREENS, '/auth/login']) {
		test(`${path} has the same layout and readable text in light and dark mode`, async ({ browser }) => {
			const signedIn = path !== '/auth/login';
			const light = await open(browser, 'light', path, { signedIn });
			const dark = await open(browser, 'dark', path, { signedIn });
			const [before, after] = await Promise.all([
				light.evaluate(firstScreen, UNSTABLE),
				dark.evaluate(firstScreen, UNSTABLE),
			]);
			expect(Object.keys(before).length).toBeGreaterThan(20);
			const changed = Object.keys(before).filter((key) => key in after && before[key] !== after[key]);
			expect(
				changed.map((key) => `${key}: ${before[key]} → ${after[key]}`),
				'layout',
			).toEqual([]);
			expect(await readable(light), 'light mode').toEqual([]);
			expect(await readable(dark), 'dark mode').toEqual([]);
			await light.context().close();
			await dark.context().close();
		});
	}

	for (const path of PHONE_SCREENS) {
		test(`${path} has readable text at phone size in light and dark mode`, async ({ browser }) => {
			for (const mode of ['light', 'dark'] as const) {
				const page = await open(browser, mode, path, { signedIn: path !== '/auth/login', phone: true });
				expect(await readable(page), `${mode} mode`).toEqual([]);
				await page.context().close();
			}
		});
	}
});

test.describe('Admin light and dark: menus, lists and popups', () => {
	for (const mode of ['light', 'dark'] as const) {
		test(`what people open is readable in ${mode} mode`, async ({ browser }) => {
			// The product list: every database the suite runs on has products.
			const page = await open(browser, mode, '/product');
			const check = async (what: string): Promise<void> => {
				await page.waitForTimeout(300);
				expect(await page.evaluate(lowContrast, CONTRAST), what).toEqual([]);
			};

			await page.locator('table [title="Delete"]:visible').first().click();
			await expect(page.locator('.modal.show')).toBeVisible();
			await check('the delete question');
			await page.keyboard.press('Escape');
			await expect(page.locator('.modal.show')).toHaveCount(0);

			await page.locator('.page-header [title="Language"]').first().click();
			await check('the header language menu');
			await page.keyboard.press('Escape');

			await page.locator('li.profile-nav').hover();
			await check('the profile menu');
			await page.mouse.move(10, 890);

			await page.goto(`${ADMIN}/qna`, { waitUntil: 'networkidle' });
			await page.locator('.select2-selection').first().click();
			await expect(page.locator('.select2-results__option').first()).toBeVisible();
			await check('an open select list');
			await page.keyboard.press('Escape');

			// The earlier Media page (moved to /media/previous in media step 2e): its Add Media popup is the one every
			// image field's picker still opens until media step 4.
			await page.goto(`${ADMIN}/media/previous`, { waitUntil: 'networkidle' });
			await page.getByText('Add Media').first().click();
			await expect(page.locator('.modal.show')).toBeVisible();
			await check('the media upload popup');
			await page.keyboard.press('Escape');

			// The Media picker (D15) and a product photo's popup (E05), media step 4.
			await page.goto(`${ADMIN}/product/edit/prd_906`, { waitUntil: 'networkidle' });
			await page.locator('.nav-link', { hasText: 'Images' }).first().click();
			await page.locator('app-product-images .choosefile-input').first().click();
			await expect(page.locator('#fm_pick_title')).toBeVisible();
			await check('the Media picker');
			await page.keyboard.press('Escape');
			const productPhoto = page.locator('app-product-images [data-photo]').first();
			if (await productPhoto.count()) {
				await productPhoto.click();
				await expect(page.locator('#product_photo_title')).toBeVisible();
				await check('a product photo popup');
				await page.keyboard.press('Escape');
			}

			// A photo's Text tab (A42, media step 4c), when the Media page has a photo at the top of My files.
			await page.goto(`${ADMIN}/media`, { waitUntil: 'networkidle' });
			const photoRow = page.locator('tr[data-file]', { hasText: /\.(jpe?g|png|webp)/i }).first();
			if (await photoRow.count()) {
				await photoRow.click({ button: 'right' });
				await page.locator('#fm_menu_details').click();
				await page.locator('#fm_details_tab_text').click();
				await expect(page.locator('#fm_text_alt')).toBeVisible();
				await check('a photo’s Text tab');
				await page.keyboard.press('Escape');
			}

			// Settings › Languages: the add popup and a language's to-do list.
			await page.goto(`${ADMIN}/setting/languages`, { waitUntil: 'networkidle' });
			await page.locator('#add_language_btn').click();
			await expect(page.locator('.modal.show')).toBeVisible();
			await check('the add-a-language popup');
			await page.keyboard.press('Escape');
			await expect(page.locator('.modal.show')).toHaveCount(0);
			const todo = page.locator('#language_todo_bn');
			if (await todo.count()) {
				await todo.click();
				await expect(page.locator('.modal.show .list-group-item').first()).toBeVisible();
				await check('a language’s to-do list');
				await page.keyboard.press('Escape');
			}

			await page.goto(`${ADMIN}/dashboard`, { waitUntil: 'networkidle' });
			const search = page.locator('.page-header input.Typeahead-input').first();
			await search.click();
			await search.fill('pro');
			await expect(page.locator('.search-full .list-group-item').first()).toBeVisible();
			await check('the search suggestions, with a highlighted row');
			await page.context().close();
		});
	}
});
