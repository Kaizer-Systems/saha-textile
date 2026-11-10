import { expect, test, type Browser, type Page } from '@playwright/test';

import { SHOP } from './support';

/**
 * Two guards for the light/dark modes, run on every pull request:
 *
 * 1. Contrast: every visible piece of text reaches WCAG AA against the solid colour behind it
 *    (4.5 : 1, or 3 : 1 for large text), in light and in dark mode. Text over a photograph is
 *    skipped: its background is a picture, which a colour check cannot judge.
 * 2. Parity: the first screen of each page has the same layout in both modes. Dark mode may only
 *    change colours (apps/storefront/scripts/build-dark-theme.mjs); a size, spacing or font that
 *    differs means a dark rule leaked layout.
 */

const PAGES = ['/en/', '/en/collections/sarees', '/en/auth/login', '/en/blogs', '/en/contact-us', '/en/faq', '/en/cart'];

interface LowContrast {
	text: string;
	ratio: number;
	color: string;
	background: string;
}

/** Runs in the page. Kept self-contained: Playwright serialises it. */
function lowContrast(): LowContrast[] {
	const luminance = (colour: string): number | null => {
		const parts = colour.match(/[\d.]+/g);
		if (!parts) return null;
		const [r, g, b, a = 1] = parts.map(Number);
		if (a < 0.9) return null;
		return [r, g, b]
			.map((channel) => {
				const value = channel / 255;
				return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
			})
			.reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
	};
	const backgroundOf = (element: Element): string | 'picture' => {
		for (let node: Element | null = element; node; node = node.parentElement) {
			const style = getComputedStyle(node);
			if (style.backgroundImage !== 'none' && !style.backgroundImage.includes('gradient')) return 'picture';
			const parts = style.backgroundColor.match(/[\d.]+/g);
			if (parts && (parts[3] === undefined || Number(parts[3]) > 0.9)) return style.backgroundColor;
		}
		return getComputedStyle(document.body).backgroundColor;
	};
	const overPicture = (element: Element): boolean => {
		const box = element.getBoundingClientRect();
		const x = box.left + box.width / 2;
		const y = box.top + box.height / 2;
		return document.elementsFromPoint(x, y).some((under) => under instanceof HTMLImageElement || under instanceof HTMLVideoElement);
	};
	const found: LowContrast[] = [];
	const seen = new Set<Element>();
	const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
	while (walker.nextNode()) {
		const node = walker.currentNode;
		const element = node.parentElement;
		if (!element || seen.has(element) || !node.textContent?.trim()) continue;
		seen.add(element);
		const box = element.getBoundingClientRect();
		const style = getComputedStyle(element);
		if (box.width < 2 || box.height < 2 || style.visibility === 'hidden' || Number(style.opacity) < 0.3) continue;
		if (element.closest('[aria-hidden="true"], .d-none, script, style, noscript, svg, [disabled], .disabled')) continue;
		const background = backgroundOf(element);
		if (background === 'picture' || overPicture(element)) continue;
		const text = luminance(style.color);
		const behind = luminance(background);
		if (text === null || behind === null) continue;
		const ratio = (Math.max(text, behind) + 0.05) / (Math.min(text, behind) + 0.05);
		const size = parseFloat(style.fontSize);
		const large = size >= 24 || (size >= 18.66 && Number(style.fontWeight) >= 700);
		if (ratio < (large ? 3 : 4.5)) {
			found.push({ text: node.textContent.trim().slice(0, 40), ratio: Math.round(ratio * 100) / 100, color: style.color, background });
		}
	}
	return found;
}

/** Runs in the page: the box and type of every visible element on the first screen. */
function firstScreen(): Record<string, string> {
	const out: Record<string, string> = {};
	const path = (element: Element): string => {
		const parts: string[] = [];
		for (let node: Element | null = element; node && node !== document.body; node = node.parentElement) {
			let index = 1;
			for (let sibling = node.previousElementSibling; sibling; sibling = sibling.previousElementSibling) index++;
			parts.unshift(`${node.tagName.toLowerCase()}:${index}`);
		}
		return parts.join('>');
	};
	for (const element of document.body.querySelectorAll('*')) {
		if (element.closest('script, style, noscript, svg, .cookie-bar-box, .toast-container')) continue;
		const box = element.getBoundingClientRect();
		if (box.width < 1 || box.height < 1 || box.top > innerHeight) continue;
		const style = getComputedStyle(element);
		out[path(element)] =
			`${Math.round(box.left)},${Math.round(box.top)},${Math.round(box.width)},${Math.round(box.height)}|` +
			`${style.fontSize}|${style.fontWeight}|${style.padding}|${style.margin}`;
	}
	return out;
}

async function open(browser: Browser, mode: 'light' | 'dark', path: string, viewport: { width: number; height: number } | null): Promise<Page> {
	const context = await browser.newContext({ viewport, ignoreHTTPSErrors: true, reducedMotion: 'reduce' });
	await context.addCookies([
		{ name: 'st_theme', value: mode, url: SHOP },
		{ name: 'st_newsletter', value: 'never', url: SHOP },
	]);
	const page = await context.newPage();
	await page.goto(path, { waitUntil: 'networkidle' });
	await page.addStyleTag({ content: '*,*::before,*::after{transition:none!important;animation:none!important}' });
	await page.waitForTimeout(500);
	return page;
}

for (const path of PAGES) {
	test(`text on ${path} is readable in light and dark mode`, async ({ browser, viewport }) => {
		for (const mode of ['light', 'dark'] as const) {
			const page = await open(browser, mode, path, viewport);
			expect(await page.evaluate(lowContrast), `${mode} mode`).toEqual([]);
			await page.context().close();
		}
	});

	test(`${path} has the same layout in light and dark mode`, async ({ browser, viewport }) => {
		const light = await open(browser, 'light', path, viewport);
		const dark = await open(browser, 'dark', path, viewport);
		const [before, after] = await Promise.all([light.evaluate(firstScreen), dark.evaluate(firstScreen)]);
		const changed = Object.keys(before).filter((key) => key in after && before[key] !== after[key]);
		expect(changed.map((key) => `${key}: ${before[key]} → ${after[key]}`)).toEqual([]);
		await light.context().close();
		await dark.context().close();
	});
}
