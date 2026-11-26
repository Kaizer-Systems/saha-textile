import { describe, expect, it, vi } from 'vitest';

import { checkAppLink } from '../src/media/app-link-check';

const answer = (status: number, body: unknown) =>
	({
		ok: status >= 200 && status < 300,
		status,
		text: async () => String(body),
		json: async () => body,
	}) as Response;

describe('checkAppLink', () => {
	it('asks Google Play only, by the app id, and names the app from its page', async () => {
		const fetcher = vi.fn(async () => answer(200, '<title>Saha Textile - Apps on Google Play</title>'));
		const result = await checkAppLink(
			{ store: 'android', url: 'https://play.google.com/store/apps/details?id=com.shop.app&hl=bn' },
			fetcher,
		);
		expect(result).toEqual({ found: true, name: 'Saha Textile' });
		expect(fetcher).toHaveBeenCalledWith(
			'https://play.google.com/store/apps/details?id=com.shop.app&hl=en',
			expect.anything(),
		);
	});

	it('says not found for a missing Play app or an address that is not a Play app page', async () => {
		const missing = vi.fn(async () => answer(404, ''));
		expect(
			await checkAppLink(
				{ store: 'android', url: 'https://play.google.com/store/apps/details?id=com.no.app' },
				missing,
			),
		).toEqual({ found: false, name: null });
		const never = vi.fn();
		expect(await checkAppLink({ store: 'android', url: 'https://evil.test/?id=com.a.b' }, never)).toEqual({
			found: false,
			name: null,
		});
		expect(never).not.toHaveBeenCalled();
	});

	it('looks the App Store app up in India, then the default store', async () => {
		const fetcher = vi
			.fn()
			.mockResolvedValueOnce(answer(200, { resultCount: 0, results: [] }))
			.mockResolvedValueOnce(answer(200, { resultCount: 1, results: [{ trackName: 'Shop' }] }));
		const result = await checkAppLink(
			{ store: 'ios', url: 'https://apps.apple.com/in/app/shop/id1234567890' },
			fetcher,
		);
		expect(result).toEqual({ found: true, name: 'Shop' });
		expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
			'https://itunes.apple.com/lookup?id=1234567890&country=in',
			'https://itunes.apple.com/lookup?id=1234567890',
		]);
		const none = vi.fn(async () => answer(200, { resultCount: 0 }));
		expect(await checkAppLink({ store: 'ios', url: 'https://apps.apple.com/app/id1234567' }, none)).toEqual({
			found: false,
			name: null,
		});
		expect(await checkAppLink({ store: 'ios', url: 'https://apple.com/' }, none)).toEqual({
			found: false,
			name: null,
		});
	});

	it('answers unknown, not "not found", when a store cannot be reached', async () => {
		const down = vi.fn(async () => answer(503, ''));
		expect(
			await checkAppLink(
				{ store: 'android', url: 'https://play.google.com/store/apps/details?id=com.a.b' },
				down,
			),
		).toBeNull();
		expect(await checkAppLink({ store: 'ios', url: 'https://apps.apple.com/app/id1234567' }, down)).toBeNull();
		const offline = vi.fn(async () => {
			throw new Error('offline');
		});
		expect(await checkAppLink({ store: 'ios', url: 'https://apps.apple.com/app/id1234567' }, offline)).toBeNull();
	});
});
