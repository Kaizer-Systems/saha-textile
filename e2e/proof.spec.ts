import { spawn, type ChildProcess } from 'node:child_process';
import { createServer, request as httpsRequest, type Server } from 'node:https';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { withDatabase } from './database';
import { expect, test } from './support';

test.skip(({ isMobile }) => isMobile, 'data and server behaviour, proven once');

const LISTING = '/en/collections/sarees/pure-silk/ikkat';
const API = 'https://localhost:4000';

test.describe.serial('Badges on real cards', () => {
	const slugs = ['bridal-ikkat-saree', 'classic-ikkat-saree', 'festive-ikkat-saree'];
	const set = (slug: string, fields: Record<string, unknown>) =>
		withDatabase((db) => db.collection('products').updateOne({ slug }, { $set: fields }));

	test.beforeAll(async () => {
		await set(slugs[0] as string, { insightBadges: ['bestseller'], featured: false });
		await set(slugs[1] as string, { lowStockThreshold: 99, lifetimeUnitsReceived: 200, featured: false });
		await set(slugs[2] as string, { backInStockAt: new Date(), lowStockThreshold: 0, featured: false });
	});

	test.afterAll(async () => {
		await set(slugs[0] as string, { insightBadges: [] });
		await set(slugs[1] as string, { lowStockThreshold: null, lifetimeUnitsReceived: 0 });
		await set(slugs[2] as string, { backInStockAt: null, lowStockThreshold: null });
	});

	const card = (page: import('@playwright/test').Page, slug: string) =>
		page.locator('app-product-box', { has: page.locator(`a[href*="${slug}"]`) }).first();

	test('bestseller, low stock and back in stock each show on their own card', async ({ page }) => {
		await page.goto(LISTING);
		await page.waitForLoadState('networkidle');
		await expect(card(page, slugs[0] as string)).toContainText('Bestseller');
		await expect(card(page, slugs[1] as string)).toContainText(/Only \d+ left/);
		await expect(card(page, slugs[2] as string)).toContainText('Back in stock');
	});
});

test.describe('Misspelled search', () => {
	test('"ikkatsilk" finds ikkat sarees in the API and on the page', async ({ page, request }) => {
		const answer = await request.get(`${API}/catalog/search?q=ikkatsilk`, { ignoreHTTPSErrors: true });
		expect(answer.ok()).toBe(true);
		const body = (await answer.json()) as { total?: number; items?: Array<{ slug: string }> };
		expect(body.items?.length ?? 0).toBeGreaterThan(0);
		expect(body.items?.some((item) => item.slug.includes('ikkat'))).toBe(true);

		await page.goto('/en/search?search=ikkatsilk');
		await page.waitForLoadState('networkidle');
		await expect(page.locator('app-product-box').first()).toContainText(/ikkat/i);
	});
});

test.describe('A slow API', () => {
	const STOREFRONT = 4211;
	const SLOW_API = 4001;
	let proxy: Server;
	let shop: ChildProcess;

	test.beforeAll(async () => {
		const root = resolve(__dirname, '..');
		proxy = createServer(
			{
				key: readFileSync(resolve(root, 'certs/localhost-key.pem')),
				cert: readFileSync(resolve(root, 'certs/localhost-cert.pem')),
			},
			(incoming, outgoing) => {
				setTimeout(() => {
					const upstream = httpsRequest(
						{
							host: 'localhost',
							port: 4000,
							path: incoming.url,
							method: incoming.method,
							headers: incoming.headers,
							rejectUnauthorized: false,
						},
						(answer) => {
							outgoing.writeHead(answer.statusCode ?? 502, answer.headers);
							answer.pipe(outgoing);
						},
					);
					upstream.on('error', () => outgoing.destroy());
					incoming.pipe(upstream);
				}, 6_000);
			},
		).listen(SLOW_API, '127.0.0.1');
		shop = spawn('node', ['dist/analog/server/index.mjs'], {
			cwd: resolve(root, 'apps/storefront'),
			stdio: 'ignore',
			env: {
				...process.env,
				PORT: String(STOREFRONT),
				NODE_OPTIONS: '--use-system-ca',
				SAHA_TEXTILE_PUBLIC_CONFIG: JSON.stringify({
					apiUrl: `https://localhost:${SLOW_API}`,
					siteUrl: `http://localhost:${STOREFRONT}`,
					defaultLocale: 'en',
					supportedLocales: ['en', 'fr'],
				}),
			},
		});
		await expect
			.poll(
				() =>
					fetch(`http://localhost:${STOREFRONT}/en/about-us`)
						.then((r) => r.status)
						.catch(() => 0),
				{
					timeout: 30_000,
				},
			)
			.toBeGreaterThan(0);
	});

	test.afterAll(() => {
		shop?.kill();
		proxy?.close();
	});

	test('the product page answers with its skeleton instead of hanging or failing', async () => {
		test.setTimeout(30_000);
		const started = Date.now();
		const response = await fetch(`http://localhost:${STOREFRONT}/en/product/bridal-ikkat-saree`);
		const html = await response.text();
		expect(response.status).toBe(200);
		expect(Date.now() - started).toBeLessThan(5_500);
		expect(html).toContain('common-skeleton');
	});
});
