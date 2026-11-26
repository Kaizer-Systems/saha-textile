import { spawn, type ChildProcess } from 'node:child_process';
import { createServer, request as httpsRequest, type Server } from 'node:https';
import { readFileSync } from 'node:fs';
import { createServer as createNetServer, type AddressInfo } from 'node:net';
import { resolve } from 'node:path';

import { withDatabase } from './database';
import { API_URL as API, expect, test } from './support';

// Data and server behaviour, proven once: the phone project leaves this file out (playwright.config.ts).

const LISTING = '/en/collections/sarees/pure-silk/ikkat';

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

/**
 * A port nothing listens on now, on any address. Fixed ports let a shop left running by another run (on 4211 for
 * Lighthouse, or a run stopped half way) answer instead of the one this test starts.
 */
async function freePort(): Promise<number> {
	const probe = createNetServer();
	await new Promise<void>((done) => probe.listen(0, done));
	const { port } = probe.address() as AddressInfo;
	await new Promise((done) => probe.close(done));
	return port;
}

/** Whether the server at `url` answers before `child` stops or `ms` pass. */
async function answers(url: string, child: ChildProcess, ms: number): Promise<boolean> {
	const deadline = Date.now() + ms;
	while (Date.now() < deadline && child.exitCode === null && child.signalCode === null) {
		const status = await fetch(url)
			.then((r) => r.status)
			.catch(() => 0);
		if (status > 0) return true;
		await new Promise((done) => setTimeout(done, 250));
	}
	return false;
}

test.describe('A slow API', () => {
	let STOREFRONT = 0;
	let SLOW_API = 0;
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
							host: new URL(API).hostname,
							port: Number(new URL(API).port || 443),
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
		);
		// Port 0: the system picks the port as it listens. A port picked first and listened on later was once taken in
		// between by an outgoing connection on a busy machine (EADDRINUSE, full local run, 24 Nov).
		await new Promise<void>((done) => proxy.listen(0, '127.0.0.1', done));
		SLOW_API = (proxy.address() as AddressInfo).port;
		// The shop is another process, so its port is picked here; if that port is taken before the shop listens, the
		// shop stops, and the next try picks another.
		for (let attempt = 1; attempt <= 3; attempt++) {
			STOREFRONT = await freePort();
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
					}),
				},
			});
			if (await answers(`http://localhost:${STOREFRONT}/en/about-us`, shop, 30_000)) return;
			shop.kill();
		}
		throw new Error('The test shop did not start in three tries.');
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
