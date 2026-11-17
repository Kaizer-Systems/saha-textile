import { describe, expect, it, vi } from 'vitest';

import { warmPage } from '../src/page-builder/page-warm';

describe('the worker’s warm after a switch (FX-8)', () => {
	it('asks the shop for the page in each shop language, and counts the answers that came', async () => {
		const fetch = vi.fn(async (url: string) => ({ status: url.includes('/bn/') ? 503 : 200 }));
		const result = await warmPage({ origin: 'https://shop.test/', locales: ['en', 'bn'], fetch }, 'home');
		expect(fetch.mock.calls.map((call) => call[0])).toEqual(['https://shop.test/en/', 'https://shop.test/bn/']);
		expect(result).toEqual({ warmed: 1, statuses: [200, 503], skipped: null });
	});

	it('treats a request that fails as no answer, never as an error', async () => {
		const fetch = vi.fn(async () => {
			throw new Error('timeout');
		});
		expect(await warmPage({ origin: 'https://shop.test', locales: ['en'], fetch }, 'home')).toEqual({
			warmed: 0,
			statuses: [0],
			skipped: null,
		});
	});

	it('skips without the shop address, and for a page type without one address', async () => {
		const fetch = vi.fn();
		expect((await warmPage({ origin: null, locales: ['en'], fetch }, 'home')).skipped).toBe('no_shop_origin');
		expect((await warmPage({ origin: 'https://shop.test', locales: ['en'], fetch }, 'product')).skipped).toBe(
			'no_single_address',
		);
		expect(fetch).not.toHaveBeenCalled();
	});
});
