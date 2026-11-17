import { test as plain } from '@playwright/test';

import { expect, test } from './support';
import { ensureHomeBanners } from './database';

/** Phones and tablets are checked both ways up. */
const PHONES = [
	[320, 568],
	[360, 640],
	[375, 667],
	[390, 844],
	[412, 915],
	[430, 932],
];
const TABLETS = [
	[600, 960],
	[768, 1024],
	[820, 1180],
	[1024, 1366],
];
const COMPUTERS = [
	[1280, 720],
	[1366, 768],
	[1440, 900],
	[1536, 864],
	[1728, 1117],
	[1920, 1080],
	[2560, 1440],
	[3840, 2160],
];
const SIZES = [
	...[...PHONES, ...TABLETS].flatMap(([width, height]) => [
		{ width: width!, height: height! },
		{ width: height!, height: width! },
	]),
	...COMPUTERS.map(([width, height]) => ({ width: width!, height: height! })),
];

/** What the box and the popup must never do to a button label, measured in the page. */
const measureButtons = (selector: string) => {
	const lineCount = (element: Element) => {
		const range = document.createRange();
		range.selectNodeContents(element);
		const rows = [...range.getClientRects()].filter((row) => row.width > 0).map((row) => Math.round(row.top / 4));
		return new Set(rows).size;
	};
	return [...document.querySelectorAll<HTMLElement>(selector)].map((button) => ({
		label: button.textContent?.trim() ?? '',
		lines: lineCount(button),
		clipped: button.scrollWidth > button.clientWidth + 1 || button.scrollHeight > button.clientHeight + 1,
		width: Math.round(button.getBoundingClientRect().width),
	}));
};

plain.describe('Cookie box at every screen size', () => {
	plain.skip(({ isMobile }) => isMobile, 'One pass covers every size; the phone project repeats nothing.');

	for (const locale of ['en', 'bn']) {
		plain(`no label is clipped or broken in ${locale}`, async ({ page }) => {
			plain.setTimeout(120_000);
			await page.addInitScript(() => sessionStorage.setItem('st_newsletter_shown', '1'));
			await page.goto(`/${locale}/`);
			await page.locator('.cookie-bar-box').waitFor();
			await page.addStyleTag({ content: '*,*::before,*::after{transition:none!important}' });

			for (const size of SIZES) {
				await page.setViewportSize(size);
				const where = `${locale} at ${size.width}x${size.height}`;
				const buttons = await page.evaluate(measureButtons, '.cookie-bar-box .button-group button');
				expect(buttons, where).toHaveLength(3);
				for (const button of buttons) {
					expect(button.clipped, `${button.label}, ${where}`).toBe(false);
					expect(button.lines, `${button.label}, ${where}`).toBe(1);
				}
				const [first, second] = buttons;
				expect(first?.width, `equal widths, ${where}`).toBe(second?.width);

				const box = await page.locator('.cookie-bar-box').evaluate((element) => {
					const rect = element.getBoundingClientRect();
					return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
				});
				expect(box.left, where).toBeGreaterThanOrEqual(0);
				expect(box.right, where).toBeLessThanOrEqual(size.width);
				expect(box.top, where).toBeGreaterThanOrEqual(0);
				expect(box.bottom, where).toBeLessThanOrEqual(size.height);
			}
		});

		plain(`the settings popup stays usable in ${locale}`, async ({ page }) => {
			plain.setTimeout(120_000);
			await page.addInitScript(() => sessionStorage.setItem('st_newsletter_shown', '1'));
			await page.goto(`/${locale}/`);
			await page.locator('#cookie_choose_btn').click();
			const popup = page.locator('.cookie-settings .modal-content');
			await popup.waitFor();
			await page.addStyleTag({
				content: '*,*::before,*::after{transition:none!important;animation:none!important}',
			});

			for (const size of SIZES) {
				await page.setViewportSize(size);
				const where = `${locale} at ${size.width}x${size.height}`;
				const buttons = await page.evaluate(measureButtons, '.cookie-settings .cookie-actions .btn');
				expect(buttons, where).toHaveLength(3);
				for (const button of buttons) {
					expect(button.clipped, `${button.label}, ${where}`).toBe(false);
					expect(button.lines, `${button.label}, ${where}`).toBe(1);
				}
				const rect = await popup.evaluate((element) => {
					const box = element.getBoundingClientRect();
					return { left: box.left, right: box.right, top: box.top, bottom: box.bottom };
				});
				expect(rect.left, where).toBeGreaterThanOrEqual(-1);
				expect(rect.right, where).toBeLessThanOrEqual(size.width + 1);
				expect(rect.top, where).toBeGreaterThanOrEqual(-1);
				expect(rect.bottom, where).toBeLessThanOrEqual(size.height + 1);
			}
		});
	}
});

test.describe('Header menu', () => {
	const sections = ['Home', 'Sarees', 'Dress Materials', 'Product', 'Mega menu', 'Blog', 'Videos', 'Pages'];

	test('shows the real categories and every demo section', async ({ page, isMobile }) => {
		await page.goto('/en/');
		if (isMobile) await page.locator('.navbar-toggler').first().click();
		const labels = page.locator('app-menu ul.navbar-nav > li > a');
		await expect(labels).toHaveCount(sections.length);
		for (const [index, section] of sections.entries()) await expect(labels.nth(index)).toContainText(section);
	});

	test('the demo product links open real products', async ({ page, request }) => {
		await page.goto('/en/');
		const link = page.locator('app-menu a[href*="/product/"]').first();
		await expect(link).toHaveAttribute('href', /\/en\/product\/(?!deliciously-sweet-watermelon)/);
		const href = await link.getAttribute('href');
		expect((await request.get(href!)).status()).toBe(200);
	});
});

test.describe('Home banners', () => {
	test.beforeAll(ensureHomeBanners);

	test('the hero plays three slides from the admin banners', async ({ page }) => {
		await page.goto('/en/');
		const hero = page.locator('.home-slider-carousel');
		await expect(hero.locator('.owl-item:not(.cloned)')).toHaveCount(3);
		await expect(hero.locator('.owl-dot')).toHaveCount(3);
		await expect(hero.locator('.owl-item:not(.cloned) picture img').first()).toHaveAttribute(
			'fetchpriority',
			'high',
		);
		await expect(hero.locator('.owl-item:not(.cloned) a').first()).toHaveAttribute('href', /\/en\/collections/);
	});

	test('the first HTML carries the hero, so nothing jumps in later', async ({ request }) => {
		const html = await (await request.get('/en/')).text();
		expect(html).toContain('home-slider-carousel');
	});

	test('the promo banners sit under the hero', async ({ page }) => {
		await page.goto('/en/');
		await expect(page.locator('.col-xxl-8 app-image-link picture img')).toBeVisible();
		await expect(page.locator('.col-xxl-4 app-image-link picture img')).toBeVisible();
	});
});

test.describe('Home blog posts', () => {
	test('their pictures are real pictures that load near the screen, at the card width', async ({ page }) => {
		const blogPictures: string[] = [];
		page.on('request', (request) => {
			if (/-blog-\d+w-/.test(request.url())) blogPictures.push(request.url());
		});
		await page.goto('/en/', { waitUntil: 'networkidle' });
		// Nothing from the blog section loads with the first screen: it is far below it.
		expect(blogPictures).toEqual([]);

		const pictures = page.locator('.slider-3-blog .blog-box-image img');
		// The e2e database seeds no blog posts; the shop's own database has them (checked there on 17 Nov).
		test.skip((await pictures.count()) === 0, 'This database has no blog posts on Home');
		// The carousel loops, so its first slides in the page are copies parked beside the visible strip; a lazy
		// picture there rightly never loads. Check the first slide on show.
		const first = page.locator('.slider-3-blog .owl-item.active .blog-box-image img').first();
		await expect(first).toHaveAttribute('loading', 'lazy');
		await expect(first).toHaveAttribute('srcset', /\d+w/);
		// The link keeps its name for screen readers; the picture inside it is part of the link.
		await expect(page.locator('.slider-3-blog .blog-image').first()).toHaveAttribute('aria-label', /.+/);

		await first.scrollIntoViewIfNeeded();
		await expect
			.poll(() => first.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0))
			.toBe(true);
		// The picture fills the theme's 65% box, as the background did (measured once the carousel has settled).
		const fit = () =>
			first.evaluate((image) => {
				const picture = image.getBoundingClientRect();
				const box = (image.parentElement as HTMLElement).getBoundingClientRect();
				return {
					width: Math.abs(picture.width - box.width),
					height: Math.abs(picture.height - box.height),
					ratio: Math.abs(box.height / box.width - 0.65),
				};
			});
		await expect.poll(async () => (await fit()).width).toBeLessThanOrEqual(1);
		const settled = await fit();
		expect(settled.height).toBeLessThanOrEqual(1);
		expect(settled.ratio).toBeLessThan(0.02);
		// A file near the card's width, never the 1600 px original on a phone.
		const chosen = await first.evaluate((image: HTMLImageElement) => image.currentSrc);
		if ((page.viewportSize()?.width ?? 0) < 580) expect(chosen).not.toMatch(/-1600w-/);
	});
});
