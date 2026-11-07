import { expect, test } from './support';

/**
 * The installable shop. `sw.js` exists only in a production build, so these skip against
 * `vite dev`; `pnpm e2e:stack` or `E2E_BASE_URL` runs them.
 */
test.describe('installable app', () => {
	test.skip(({ isMobile }) => isMobile, 'server and browser behaviour, proven once');

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
		await page.goto('/fr/');
		await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', '/manifest.webmanifest?lang=fr');

		const french = await (await request.get('/manifest.webmanifest?lang=fr')).json();
		const english = await (await request.get('/manifest.webmanifest?lang=en')).json();
		expect(french).toMatchObject({ start_url: '/fr/', display: 'standalone', scope: '/' });
		expect(english.start_url).toBe('/en/');
		expect(french.id).toBe(english.id);
		expect(french.name).toBeTruthy();
		for (const icon of french.icons) {
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
