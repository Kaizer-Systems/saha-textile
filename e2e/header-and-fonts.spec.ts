import { readsHome } from './home-lock';
import { buyBoxReady, expect, test } from './support';

/**
 * The header after its code split (search, cart and account load their code when needed; search itself is covered by
 * search.spec.ts) and the বাংলা text font (preloaded on বাংলা pages so nothing moves when it arrives), 17 Nov.
 */
test.describe('the header and the page fonts', () => {
	// The বাংলা page is Home, measured as a fresh test database has it.
	readsHome();

	test('the cart count follows the cart without touching the header', async ({ page }) => {
		await page.goto('/en/product/katan-banarasi-saree');
		// A click before Angular has taken over the buy box was lost under a full parallel run.
		const add = (await buyBoxReady(page)).locator('button', { hasText: /add to cart/i }).first();
		await add.click();
		await expect(page.locator('app-header-cart .badge').first()).toContainText('1');
	});

	test('বাংলা pages preload their Bengali text font; English pages do not', async ({ page }) => {
		const bengali = '/assets/fonts/text/noto-sans-bengali-normal-400-600-bengali.woff2';
		const bn = await (await page.request.get('/bn/')).text();
		const en = await (await page.request.get('/en/')).text();
		expect(bn).toMatch(new RegExp(`<link rel="preload" href="${bengali}" as="font"`));
		expect(en).not.toContain(`href="${bengali}" as="font"`);
	});

	test('nothing moves on a বাংলা page while it loads', async ({ page }) => {
		await page.addInitScript(() => {
			const record = window as unknown as { shift: number; moved: string[] };
			record.shift = 0;
			record.moved = [];
			new PerformanceObserver((list) => {
				for (const entry of list.getEntries() as Array<
					PerformanceEntry & {
						value: number;
						hadRecentInput: boolean;
						sources?: Array<{
							node?: Node | null;
							previousRect: DOMRectReadOnly;
							currentRect: DOMRectReadOnly;
						}>;
					}
				>) {
					if (entry.hadRecentInput) continue;
					record.shift += entry.value;
					// Which elements moved, and from where to where: CI keeps no screenshots.
					for (const source of entry.sources ?? []) {
						const node = source.node as Element | null | undefined;
						const name = node
							? `${node.nodeName.toLowerCase()}.${String(node.className ?? '')
									.trim()
									.replace(/\s+/g, '.')}`
							: '?';
						const rect = (r: DOMRectReadOnly) =>
							`${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}×${Math.round(r.height)}`;
						record.moved.push(
							`${entry.value.toFixed(4)} ${name} ${rect(source.previousRect)} → ${rect(source.currentRect)}`,
						);
					}
				}
			}).observe({ type: 'layout-shift', buffered: true });
		});
		await page.goto('/bn/');
		await page.waitForLoadState('networkidle');
		await page.waitForTimeout(1500);
		const { shift, moved } = await page.evaluate(() => {
			const record = window as unknown as { shift: number; moved: string[] };
			return { shift: record.shift, moved: record.moved };
		});
		expect(shift, `moved: ${moved.join(' ; ') || 'nothing'}`).toBeLessThan(0.001);
	});
});
