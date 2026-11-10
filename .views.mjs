import { chromium } from '@playwright/test';
import { writeFileSync } from 'node:fs';
const OUT = process.argv[2];
const B = 'https://localhost:4200';
const PAGES = {
	home: '/en/', home_bn: '/bn/', category: '/en/collections/dress-materials', subcategory: '/en/collections/dress-materials/banarasi',
	product_addon: '/en/product/antique-gold-rangkat-wedding-banarasi-saree', product_swatch: '/en/product/antique-gold-lucknowi-shadow-work-printed-cotton-salwar-suit',
	product_bn: '/bn/product/antique-gold-rangkat-wedding-banarasi-saree', search: '/en/search?q=silk', cart: '/en/cart', checkout: '/en/checkout',
	login: '/en/auth/login', register: '/en/auth/register', forgot: '/en/auth/forgot-password', account: '/en/account/dashboard',
	blogs: '/en/blogs', blog: '/en/blog/bengal-cotton-sarees-for-summer', videos: '/en/videos', contact: '/en/contact-us', faq: '/en/faq',
	about: '/en/about-us', privacy: '/en/privacy-policy', wishlist: '/en/wishlist', compare: '/en/compare', offer: '/en/offer', notfound: '/en/no-such-page',
};
// WCAG contrast for visible text against the first solid background behind it; text over pictures is skipped.
const CHECK = () => {
	const lum = (c) => { const m = c.match(/[\d.]+/g); if (!m) return null; const [r, g, b, a = 1] = m.map(Number); if (a < 0.9) return null; return [r, g, b].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }).reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0); };
	const bgOf = (el) => { for (let e = el; e; e = e.parentElement) { const s = getComputedStyle(e); if (s.backgroundImage !== 'none' && !s.backgroundImage.includes('gradient')) return 'image'; const m = s.backgroundColor.match(/[\d.]+/g); if (m && (m[3] === undefined || Number(m[3]) > 0.9)) return s.backgroundColor; } return getComputedStyle(document.body).backgroundColor; };
	const bad = [];
	const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
	const seen = new Set();
	while (walker.nextNode()) {
		const t = walker.currentNode; const el = t.parentElement; if (!el || seen.has(el) || !t.textContent.trim()) continue; seen.add(el);
		const r = el.getBoundingClientRect(); const s = getComputedStyle(el);
		if (r.width < 2 || r.height < 2 || s.visibility === 'hidden' || Number(s.opacity) < 0.3 || el.closest('[aria-hidden="true"],.d-none,script,style,noscript')) continue;
		if (el.closest('img,picture,svg')) continue;
		const bg = bgOf(el); if (bg === 'image') continue;
		const L1 = lum(s.color), L2 = lum(bg); if (L1 == null || L2 == null) continue;
		const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
		const size = parseFloat(s.fontSize); const large = size >= 24 || (size >= 18.66 && Number(s.fontWeight) >= 700);
		if (ratio < (large ? 3 : 4.5)) bad.push({ text: t.textContent.trim().slice(0, 50), ratio: Math.round(ratio * 100) / 100, color: s.color, bg, sel: el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).slice(0, 3).join('.') : '') });
	}
	const whiteBoxes = [...document.querySelectorAll('div,section,li,ul,form,table,td,th,input,select,textarea,button,a,.card,.modal-content')].filter((e) => { const s = getComputedStyle(e); const r = e.getBoundingClientRect(); return r.width > 120 && r.height > 30 && /rgb\((2[3-5]\d), (2[3-5]\d), (2[3-5]\d)\)/.test(s.backgroundColor) && r.top < document.body.scrollHeight; }).slice(0, 15).map((e) => e.tagName.toLowerCase() + '.' + (typeof e.className === 'string' ? e.className.trim().split(/\s+/).slice(0, 3).join('.') : '') + ' ' + getComputedStyle(e).backgroundColor);
	const logos = [...document.querySelectorAll('header img, footer img, .modal-logo')].map((i) => i.currentSrc.split('/').pop()?.slice(0, 50));
	return { bad: bad.slice(0, 40), badCount: bad.length, whiteBoxes, logos, dark: document.documentElement.classList.contains('dark'), overflow: document.documentElement.scrollWidth > innerWidth + 1 };
};
const browser = await chromium.launch({ channel: 'chrome' });
const report = {};
for (const [w, h, tag] of [[1280, 800, 'desktop'], [390, 844, 'phone']]) {
	const ctx = await browser.newContext({ viewport: { width: w, height: h }, ignoreHTTPSErrors: true, deviceScaleFactor: 1 });
	await ctx.addCookies([{ name: 'st_theme', value: 'dark', url: B }, { name: 'st_consent', value: encodeURIComponent(JSON.stringify({ id: 'audit', version: '2026-11-10', savedAt: new Date().toISOString(), categories: { functional: true, analytics: false, targeting: false, marketing: false, promotional: false } })), url: B }, { name: 'st_newsletter', value: 'never', url: B }]);
	const page = await ctx.newPage();
	for (const [name, path] of Object.entries(PAGES)) {
		try {
			await page.goto(B + path, { waitUntil: 'networkidle', timeout: 45000 });
			await page.waitForTimeout(900);
			const height = await page.evaluate(() => document.documentElement.scrollHeight);
			const spots = { top: 0, middle: Math.max(0, Math.round(height / 2 - h / 2)), bottom: Math.max(0, height - h) };
			const views = {};
			for (const [where, y] of Object.entries(spots)) {
				if ((where === 'middle' && y < h * 0.6) || (where === 'bottom' && y < 100)) continue;
				await page.evaluate((top) => window.scrollTo(0, top), y);
				await page.waitForTimeout(700);
				const file = `${name}-${tag}-${where}.jpg`;
				await page.screenshot({ path: `${OUT}/views/${file}`, type: 'jpeg', quality: 62 });
				views[where] = file;
			}
			report[`${name}@${tag}`] = { url: page.url(), height, views };
		} catch (e) { report[`${name}@${tag}`] = { error: String(e).slice(0, 200) }; }
	}
	await ctx.close();
}
await browser.close();
writeFileSync(`${OUT}/views.json`, JSON.stringify(report, null, 1));
for (const [k, v] of Object.entries(report)) console.log(k.padEnd(28), v.error ? 'ERROR ' + v.error : `${v.height}px ${Object.keys(v.views).join(',')} ${v.url.replace(B, '')}`);
