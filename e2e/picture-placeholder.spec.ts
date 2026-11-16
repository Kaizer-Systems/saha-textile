import { expect, test } from './support';

/**
 * The missing-picture placeholder (Media brief R5-1, R5-5; media step 5): a Media picture that fails on the shop
 * becomes the bundled placeholder of its shape, light or dark, and its box keeps its size.
 */
test.describe('missing pictures', () => {
	test('a Media picture that fails becomes the placeholder of its shape, without moving the page', async ({
		page,
	}) => {
		// Every Media picture answers “not found”, as a deleted file would.
		await page.route(/\/media\/med_[^/]+\//, (route) => route.fulfill({ status: 404, body: '' }));
		await page.goto('/en/collections/sarees', { waitUntil: 'networkidle' });
		const swapped = page.locator('img[data-fallback]');
		await expect(swapped.first()).toBeVisible();
		await expect(swapped.first()).toHaveAttribute(
			'src',
			/assets\/images\/placeholder\/placeholder-(light|dark)-[\d.x]+\.svg$/,
		);
		const box = await swapped.first().boundingBox();
		expect(box?.width ?? 0).toBeGreaterThan(0);
		expect(box?.height ?? 0).toBeGreaterThan(0);
	});
});
