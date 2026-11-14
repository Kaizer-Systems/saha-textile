import { expect, test, type Browser, type Page } from '@playwright/test';

import { firstScreen } from './colour-checks';
import { ADMIN, ADMIN_STATE } from './support';

/**
 * The admin's light and dark modes, the same guards as the shop's `dark-mode.spec.ts`:
 *
 * 1. Dark mode is its own stylesheet, downloaded only in dark mode, applied before the first paint
 *    (`public/assets/js/theme-mode.js`) and remembered in this browser.
 * 2. Parity: every screen has the same layout in both modes. The dark stylesheet only changes
 *    colours (`apps/admin/scripts/build-dark-theme.mjs`); a size, spacing or font that differs
 *    means a dark rule leaked layout.
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
	'/home-banners',
	'/event',
	'/blog',
	'/page',
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
	'/setting/notifications',
];

/** Moving parts that differ from one load to the next whatever the mode. */
const UNSTABLE = 'ngx-loading-bar, .toast-container, #toast-container, .apexcharts-canvas';

const STILL =
	'*,*::before,*::after{transition:none!important;animation:none!important;caret-color:transparent!important}';

async function open(
	browser: Browser,
	mode: 'light' | 'dark',
	path: string,
	options: { signedIn?: boolean } = {},
): Promise<Page> {
	const context = await browser.newContext({
		viewport: { width: 1440, height: 900 },
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
	await page.waitForTimeout(400);
	return page;
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
	}) => {
		const page = await open(browser, 'dark', '/auth/login', { signedIn: false });
		await expect(page.locator('body')).toHaveClass(/dark-only/);
		expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe('rgb(11, 20, 29)');
		await page.context().close();
	});
});

test.describe('Admin light and dark parity', () => {
	for (const path of [...SCREENS, '/auth/login']) {
		test(`${path} has the same layout in light and dark mode`, async ({ browser }) => {
			const signedIn = path !== '/auth/login';
			const light = await open(browser, 'light', path, { signedIn });
			const dark = await open(browser, 'dark', path, { signedIn });
			const [before, after] = await Promise.all([
				light.evaluate(firstScreen, UNSTABLE),
				dark.evaluate(firstScreen, UNSTABLE),
			]);
			expect(Object.keys(before).length).toBeGreaterThan(20);
			const changed = Object.keys(before).filter((key) => key in after && before[key] !== after[key]);
			expect(changed.map((key) => `${key}: ${before[key]} → ${after[key]}`)).toEqual([]);
			await light.context().close();
			await dark.context().close();
		});
	}
});
